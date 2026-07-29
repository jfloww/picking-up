from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts.models import GoogleIdentity


User = get_user_model()


class AuthApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_register_creates_user(self):
        response = self.client.post(
            "/api/auth/register/",
            {"email": "test@example.com", "password": "StrongPass123!"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(User.objects.filter(email="test@example.com").exists())

    def test_token_and_me(self):
        User.objects.create_user(
            username="test@example.com",
            email="test@example.com",
            password="StrongPass123!",
        )

        token_response = self.client.post(
            "/api/auth/token/",
            {"email": "test@example.com", "password": "StrongPass123!"},
            format="json",
        )

        self.assertEqual(token_response.status_code, 200)
        access_token = token_response.data["access"]

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
        me_response = self.client.get("/api/auth/me/")

        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.data["email"], "test@example.com")

    def test_logout_blacklists_refresh_token(self):
        User.objects.create_user(
            username="test@example.com",
            email="test@example.com",
            password="StrongPass123!",
        )

        token_response = self.client.post(
            "/api/auth/token/",
            {"email": "test@example.com", "password": "StrongPass123!"},
            format="json",
        )
        refresh_token = token_response.data["refresh"]

        logout_response = self.client.post(
            "/api/auth/logout/",
            {"refresh": refresh_token},
            format="json",
        )
        self.assertEqual(logout_response.status_code, 205)

        retry_response = self.client.post(
            "/api/auth/token/refresh/",
            {"refresh": refresh_token},
            format="json",
        )
        self.assertEqual(retry_response.status_code, 401)


class GoogleIdentityModelTests(TestCase):
    def test_sub_must_be_unique(self):
        user_a = User.objects.create_user(username="a@example.com", email="a@example.com")
        user_b = User.objects.create_user(username="b@example.com", email="b@example.com")
        GoogleIdentity.objects.create(user=user_a, sub="dup-sub", email="a@example.com")

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                GoogleIdentity.objects.create(user=user_b, sub="dup-sub", email="b@example.com")

    def test_user_email_must_be_unique_at_the_database_level(self):
        User.objects.create_user(username="a@example.com", email="dup@example.com")

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                User.objects.create_user(username="b@example.com", email="dup@example.com")


@override_settings(GOOGLE_OAUTH_CLIENT_ID="test-client-id.apps.googleusercontent.com")
class GoogleAuthApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def _claims(self, **overrides):
        claims = {
            "sub": "google-sub-123",
            "email": "jane@example.com",
            "email_verified": True,
        }
        claims.update(overrides)
        return claims

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_new_user_created_with_unusable_password(self, mock_verify):
        mock_verify.return_value = self._claims()

        response = self.client.post("/api/auth/google/", {"credential": "token"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)
        user = User.objects.get(email="jane@example.com")
        self.assertFalse(user.has_usable_password())
        self.assertTrue(GoogleIdentity.objects.filter(user=user, sub="google-sub-123").exists())

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_returning_google_user_does_not_duplicate_identity(self, mock_verify):
        mock_verify.return_value = self._claims()
        user = User.objects.create_user(username="jane@example.com", email="jane@example.com")
        GoogleIdentity.objects.create(user=user, sub="google-sub-123", email="jane@example.com")

        response = self.client.post("/api/auth/google/", {"credential": "token"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(GoogleIdentity.objects.filter(sub="google-sub-123").count(), 1)
        access_token = response.data["access"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
        me_response = self.client.get("/api/auth/me/")
        self.assertEqual(me_response.data["email"], "jane@example.com")

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_existing_password_account_gets_linked_by_email(self, mock_verify):
        mock_verify.return_value = self._claims()
        existing = User.objects.create_user(
            username="jane@example.com", email="jane@example.com", password="StrongPass123!"
        )

        response = self.client.post("/api/auth/google/", {"credential": "token"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(User.objects.filter(email="jane@example.com").count(), 1)
        identity = GoogleIdentity.objects.get(sub="google-sub-123")
        self.assertEqual(identity.user_id, existing.id)
        existing.refresh_from_db()
        self.assertTrue(existing.has_usable_password())  # linking never touches the existing password

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_invalid_token_is_rejected(self, mock_verify):
        mock_verify.side_effect = ValueError("Invalid token signature")

        response = self.client.post("/api/auth/google/", {"credential": "bad-token"}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(User.objects.count(), 0)

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_wrong_audience_is_rejected(self, mock_verify):
        mock_verify.side_effect = ValueError("Token has wrong audience")

        response = self.client.post("/api/auth/google/", {"credential": "token"}, format="json")

        self.assertEqual(response.status_code, 400)

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_verifies_token_against_the_configured_audience(self, mock_verify):
        mock_verify.return_value = self._claims()

        self.client.post("/api/auth/google/", {"credential": "token"}, format="json")

        args, kwargs = mock_verify.call_args
        self.assertEqual(args[0], "token")
        self.assertEqual(kwargs["audience"], settings.GOOGLE_OAUTH_CLIENT_ID)

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_unverified_email_is_rejected(self, mock_verify):
        mock_verify.return_value = self._claims(email_verified=False)

        response = self.client.post("/api/auth/google/", {"credential": "token"}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(User.objects.count(), 0)

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_mismatched_origin_is_rejected(self, mock_verify):
        mock_verify.return_value = self._claims()

        response = self.client.post(
            "/api/auth/google/",
            {"credential": "token"},
            format="json",
            HTTP_ORIGIN="https://evil.example.com",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(User.objects.count(), 0)

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_matching_origin_is_allowed(self, mock_verify):
        mock_verify.return_value = self._claims()

        response = self.client.post(
            "/api/auth/google/",
            {"credential": "token"},
            format="json",
            HTTP_ORIGIN=settings.CORS_ALLOWED_ORIGINS[0],
        )

        self.assertEqual(response.status_code, 200)

    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_missing_credential_is_rejected(self, mock_verify):
        response = self.client.post("/api/auth/google/", {}, format="json")

        self.assertEqual(response.status_code, 400)
        mock_verify.assert_not_called()

    @override_settings(GOOGLE_OAUTH_CLIENT_ID=None)
    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_refuses_to_serve_when_client_id_is_not_configured(self, mock_verify):
        response = self.client.post("/api/auth/google/", {"credential": "token"}, format="json")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data, {"error": "Google sign-in is not configured."})
        self.assertEqual(User.objects.count(), 0)
        mock_verify.assert_not_called()

from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from rest_framework import serializers as drf_serializers
from rest_framework.test import APIClient, APIRequestFactory

from apps.accounts.models import GoogleIdentity
from apps.accounts.serializers import RegisterSerializer
from apps.accounts.throttles import (
    GoogleBurstThrottle,
    GoogleSustainedThrottle,
    LoginBurstThrottle,
    LoginSustainedThrottle,
    RegisterBurstThrottle,
    RegisterSustainedThrottle,
)


User = get_user_model()


class AuthApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient(REMOTE_ADDR="198.51.100.10")

    def test_register_creates_user(self):
        response = self.client.post(
            "/api/auth/register/",
            {"email": "test@example.com", "password": "StrongPass123!"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(User.objects.filter(email="test@example.com").exists())

    def test_register_rejects_a_case_variant_duplicate_email(self):
        # RF-019: the duplicate check used to be an exact match while
        # EmailBackend's login lookup is case-insensitive, so two
        # case-variant registrations could both succeed and then both be
        # permanently locked out of password login by
        # MultipleObjectsReturned. The check must use the same __iexact
        # comparison as the lookup it protects.
        User.objects.create_user(
            username="dup@example.com", email="dup@example.com", password="StrongPass123!",
        )

        response = self.client.post(
            "/api/auth/register/",
            {"email": "DUP@example.com", "password": "StrongPass123!"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(User.objects.filter(email__iexact="dup@example.com").count(), 1)

    def test_register_rejects_a_duplicate_username_with_an_available_email(self):
        # `username` is an exposed, independently-unique optional field on
        # this endpoint (create() falls back to email only when it's
        # blank) — a caller can collide on username alone while the email
        # is genuinely free. The response must name the field that's
        # actually taken.
        User.objects.create_user(
            username="taken-name", email="original@example.com", password="StrongPass123!",
        )

        response = self.client.post(
            "/api/auth/register/",
            {"email": "fresh@example.com", "username": "taken-name", "password": "StrongPass123!"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("username", response.data)
        self.assertFalse(User.objects.filter(email__iexact="fresh@example.com").exists())

    def test_register_converts_a_raced_username_integrity_error_into_a_username_error(self):
        # Same TOCTOU shape as the email race below, but for username: the
        # create() exception handler used to assume any IntegrityError
        # meant an email collision, which would have misreported this case
        # (a real username collision, an available email) as "email already
        # exists" — a false statement about a field that isn't taken.
        # Exercised directly against create() for the same reason as the
        # email race test: reproducing genuine concurrency isn't practical
        # here, and the DB-level failure and its handling are identical
        # either way.
        User.objects.create_user(
            username="raced-name", email="original@example.com", password="StrongPass123!",
        )

        with self.assertRaises(drf_serializers.ValidationError) as ctx:
            RegisterSerializer().create({
                "email": "fresh-race@example.com",
                "username": "raced-name",
                "password": "StrongPass123!",
            })

        self.assertIn("username", ctx.exception.detail)
        self.assertNotIn("email", ctx.exception.detail)

    def test_register_converts_a_raced_integrity_error_into_a_validation_error(self):
        # The __iexact pre-check in validate_email narrows the race window
        # but isn't itself atomic — two concurrent registrations for
        # case-variant emails can both pass it before either commits. The
        # database's unique index is the real, atomic boundary, so create()
        # must convert the loser's IntegrityError into the same 400 the
        # pre-check would have raised sequentially, not let it surface as
        # an unhandled 500. Exercised directly against create() since
        # reproducing genuine concurrency isn't practical here — the
        # DB-level failure and its handling are identical either way.
        User.objects.create_user(
            username="race@example.com", email="race@example.com", password="StrongPass123!",
        )

        with self.assertRaises(drf_serializers.ValidationError) as ctx:
            RegisterSerializer().create({
                "email": "race@example.com",
                "username": None,
                "password": "StrongPass123!",
            })

        self.assertIn("email", ctx.exception.detail)

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

    def test_token_normalizes_email_and_updates_last_login(self):
        user = User.objects.create_user(
            username="test@example.com",
            email="test@example.com",
            password="StrongPass123!",
        )

        response = self.client.post(
            "/api/auth/token/",
            {"email": "  TEST@EXAMPLE.COM  ", "password": "StrongPass123!"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        self.assertIsNotNone(user.last_login)

    def test_wrong_password_unknown_email_and_inactive_user_share_failure_contract(self):
        User.objects.create_user(
            username="active@example.com",
            email="active@example.com",
            password="StrongPass123!",
        )
        inactive = User.objects.create_user(
            username="inactive@example.com",
            email="inactive@example.com",
            password="StrongPass123!",
        )
        inactive.is_active = False
        inactive.save(update_fields=["is_active"])

        responses = [
            self.client.post(
                "/api/auth/token/",
                {"email": "active@example.com", "password": "WrongPass123!"},
                format="json",
            ),
            self.client.post(
                "/api/auth/token/",
                {"email": "missing@example.com", "password": "WrongPass123!"},
                format="json",
            ),
            self.client.post(
                "/api/auth/token/",
                {"email": "inactive@example.com", "password": "StrongPass123!"},
                format="json",
            ),
        ]

        for response in responses:
            self.assertEqual(response.status_code, 401)
        self.assertEqual(responses[0].data, responses[1].data)
        self.assertEqual(responses[1].data, responses[2].data)

    def test_case_variant_duplicate_emails_fail_login_with_a_logged_warning(self):
        # RF-019: reachable only via admin/shell, which bypass the
        # lowercasing RegisterSerializer applies — the API's own duplicate
        # check (see test_register_rejects_a_case_variant_duplicate_email)
        # cannot produce this state. The DB-level email index is
        # case-sensitive (migration 0002_unique_user_email), so both
        # inserts succeed and EmailBackend's __iexact lookup then matches
        # both rows.
        User.objects.create_user(
            username="dup@example.com", email="dup@example.com", password="StrongPass123!",
        )
        User.objects.create_user(
            username="DUP@example.com", email="DUP@example.com", password="StrongPass123!",
        )

        with self.assertLogs("apps.accounts.backends", level="WARNING") as logs:
            response = self.client.post(
                "/api/auth/token/",
                {"email": "dup@example.com", "password": "StrongPass123!"},
                format="json",
            )

        self.assertEqual(response.status_code, 401)
        self.assertIn("dup@example.com", logs.output[0])

    @patch("apps.accounts.backends.make_password")
    def test_unknown_email_performs_dummy_password_hash(self, mock_make_password):
        response = self.client.post(
            "/api/auth/token/",
            {"email": "missing@example.com", "password": "WrongPass123!"},
            format="json",
        )

        self.assertEqual(response.status_code, 401)
        mock_make_password.assert_called_once_with("WrongPass123!")

    def test_missing_fields_malformed_email_and_malformed_json_are_rejected(self):
        missing_email = self.client.post(
            "/api/auth/token/",
            {"password": "StrongPass123!"},
            format="json",
        )
        malformed_email = self.client.post(
            "/api/auth/token/",
            {"email": "not-an-email", "password": "StrongPass123!"},
            format="json",
        )
        malformed_json = self.client.generic(
            "POST",
            "/api/auth/token/",
            data="{not-json",
            content_type="application/json",
        )

        self.assertEqual(missing_email.status_code, 400)
        self.assertIn("email", missing_email.data)
        self.assertEqual(malformed_email.status_code, 400)
        self.assertIn("email", malformed_email.data)
        self.assertEqual(malformed_json.status_code, 400)

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


class AuthenticationThrottleTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient(REMOTE_ADDR="203.0.113.50")

    def tearDown(self):
        cache.clear()

    @patch.object(LoginBurstThrottle, "rate", "1/min", create=True)
    @patch.object(LoginSustainedThrottle, "rate", "100/day", create=True)
    def test_login_burst_limit_returns_429_with_retry_after(self):
        payload = {"email": "missing@example.com", "password": "WrongPass123!"}

        first = self.client.post("/api/auth/token/", payload, format="json")
        second = self.client.post("/api/auth/token/", payload, format="json")

        self.assertEqual(first.status_code, 401)
        self.assertEqual(second.status_code, 429)
        self.assertIn("Retry-After", second)

    @patch.object(LoginBurstThrottle, "rate", "100/min", create=True)
    @patch.object(LoginSustainedThrottle, "rate", "1/day", create=True)
    def test_login_sustained_limit_returns_429(self):
        payload = {"email": "missing@example.com", "password": "WrongPass123!"}

        first = self.client.post("/api/auth/token/", payload, format="json")
        second = self.client.post("/api/auth/token/", payload, format="json")

        self.assertEqual(first.status_code, 401)
        self.assertEqual(second.status_code, 429)

    @patch.object(LoginBurstThrottle, "rate", "1/min", create=True)
    @patch.object(LoginSustainedThrottle, "rate", "100/day", create=True)
    def test_burst_rejected_requests_do_not_consume_the_sustained_budget(self):
        # RF-018 regression: DRF's default check_throttles() calls
        # allow_request() on every throttle unconditionally, so a request
        # already rejected by the burst throttle used to still be recorded
        # against the sustained throttle's daily budget — making the
        # advertised daily limit exhaust ~20x faster than it implies.
        payload = {"email": "missing@example.com", "password": "WrongPass123!"}

        responses = [self.client.post("/api/auth/token/", payload, format="json") for _ in range(5)]

        self.assertEqual(responses[0].status_code, 401)
        self.assertTrue(all(response.status_code == 429 for response in responses[1:]))

        throttle = LoginSustainedThrottle()
        request = APIRequestFactory().post("/api/auth/token/", REMOTE_ADDR="203.0.113.50")
        cache_key = throttle.get_cache_key(request, view=None)
        history = cache.get(cache_key) or []
        self.assertEqual(
            len(history),
            1,
            "the sustained throttle should only record the one request that "
            "actually reached it (the first), not the four burst-rejected "
            "requests behind it",
        )

    @patch.object(RegisterBurstThrottle, "rate", "1/min", create=True)
    @patch.object(RegisterSustainedThrottle, "rate", "100/day", create=True)
    def test_registration_has_its_own_burst_limit(self):
        first = self.client.post(
            "/api/auth/register/",
            {"email": "first@example.com", "password": "StrongPass123!"},
            format="json",
        )
        second = self.client.post(
            "/api/auth/register/",
            {"email": "second@example.com", "password": "StrongPass123!"},
            format="json",
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 429)

    @override_settings(GOOGLE_OAUTH_CLIENT_ID="test-client-id.apps.googleusercontent.com")
    @patch.object(GoogleBurstThrottle, "rate", "1/min", create=True)
    @patch.object(GoogleSustainedThrottle, "rate", "100/day", create=True)
    @patch("apps.accounts.views.google_id_token.verify_oauth2_token")
    def test_google_sign_in_has_its_own_burst_limit(self, mock_verify):
        mock_verify.return_value = {
            "sub": "google-sub-throttle",
            "email": "throttle@example.com",
            "email_verified": True,
        }

        first = self.client.post("/api/auth/google/", {"credential": "token"}, format="json")
        second = self.client.post("/api/auth/google/", {"credential": "token"}, format="json")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)
        mock_verify.assert_called_once()

    @override_settings(
        REST_FRAMEWORK={**settings.REST_FRAMEWORK, "NUM_PROXIES": 1},
    )
    def test_client_ip_uses_last_forwarded_address_with_one_trusted_proxy(self):
        request = APIRequestFactory().get(
            "/api/auth/token/",
            HTTP_X_FORWARDED_FOR="203.0.113.9, 198.51.100.71",
            REMOTE_ADDR="127.0.0.1",
        )

        key = LoginBurstThrottle().get_cache_key(request, view=None)

        self.assertEqual(key, "throttle_auth_login_burst_198.51.100.71")


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
        cache.clear()
        self.client = APIClient(REMOTE_ADDR="198.51.100.20")

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
    def test_existing_account_link_race_reuses_the_winning_identity(self, mock_verify):
        mock_verify.return_value = self._claims()
        existing = User.objects.create_user(
            username="jane@example.com",
            email="jane@example.com",
            password="StrongPass123!",
        )
        winning_identity = GoogleIdentity(
            user=existing,
            sub="google-sub-123",
            email="jane@example.com",
        )

        with (
            patch("apps.accounts.views.GoogleIdentity.objects.select_related") as select_related,
            patch(
                "apps.accounts.views.GoogleIdentity.objects.create",
                side_effect=IntegrityError("lost identity insert race"),
            ),
        ):
            select_related.return_value.filter.return_value.first.side_effect = [
                None,
                winning_identity,
            ]
            response = self.client.post(
                "/api/auth/google/",
                {"credential": "token"},
                format="json",
            )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("access", response.data)

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

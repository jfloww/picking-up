from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase
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

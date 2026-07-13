from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient


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

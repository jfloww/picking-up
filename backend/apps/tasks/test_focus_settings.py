import uuid

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from .models import FocusSettings
from .serializers import FOCUS_AREAS_MAX_COUNT


User = get_user_model()


def focus_area(title, *, area_id=None, description="", archived=False):
    return {
        "id": str(area_id or uuid.uuid4()),
        "title": title,
        "description": description,
        "archived": archived,
    }


class FocusSettingsApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="focus@example.com",
            email="focus@example.com",
            password="StrongPass123!",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_get_returns_empty_settings_without_creating_a_row(self):
        response = self.client.get("/api/focus-settings/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["focus_areas"], [])
        self.assertIsNone(response.data["active_focus_id"])
        self.assertFalse(FocusSettings.objects.filter(user=self.user).exists())

    def test_put_round_trips_multiple_areas_and_active_selection(self):
        first = focus_area(
            "  LangChain, RAG & AI Agents  ",
            description="  Build production-ready agents.  ",
        )
        second = focus_area("Health & Strength")

        response = self.client.put(
            "/api/focus-settings/",
            {"focus_areas": [first, second], "active_focus_id": first["id"]},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["focus_areas"][0]["title"], "LangChain, RAG & AI Agents")
        self.assertEqual(response.data["focus_areas"][0]["description"], "Build production-ready agents.")
        self.assertEqual(response.data["active_focus_id"], first["id"])

    def test_put_rejects_duplicate_ids(self):
        area_id = uuid.uuid4()
        response = self.client.put(
            "/api/focus-settings/",
            {
                "focus_areas": [
                    focus_area("One", area_id=area_id),
                    focus_area("Two", area_id=area_id),
                ],
                "active_focus_id": None,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_put_rejects_an_archived_or_unknown_active_focus(self):
        archived = focus_area("Archived", archived=True)
        archived_response = self.client.put(
            "/api/focus-settings/",
            {"focus_areas": [archived], "active_focus_id": archived["id"]},
            format="json",
        )
        unknown_response = self.client.put(
            "/api/focus-settings/",
            {"focus_areas": [focus_area("Current")], "active_focus_id": str(uuid.uuid4())},
            format="json",
        )

        self.assertEqual(archived_response.status_code, 400)
        self.assertEqual(unknown_response.status_code, 400)

    def test_put_caps_the_number_of_focus_areas(self):
        response = self.client.put(
            "/api/focus-settings/",
            {
                "focus_areas": [focus_area(str(index)) for index in range(FOCUS_AREAS_MAX_COUNT + 1)],
                "active_focus_id": None,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_settings_are_private_to_each_user(self):
        mine = focus_area("Mine")
        self.client.put(
            "/api/focus-settings/",
            {"focus_areas": [mine], "active_focus_id": mine["id"]},
            format="json",
        )
        other = User.objects.create_user(username="other@example.com", password="StrongPass123!")
        other_client = APIClient()
        other_client.force_authenticate(other)

        response = other_client.get("/api/focus-settings/")

        self.assertEqual(response.data["focus_areas"], [])

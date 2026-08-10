from django.test import TestCase, override_settings


class HealthViewTests(TestCase):
    def test_returns_ok_status_service_name_and_exactly_the_expected_keys(self):
        response = self.client.get("/api/health/")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["service"], "picking-up-api")
        self.assertEqual(
            set(data.keys()), {"status", "service", "version", "commit", "environment"}
        )

    def test_returns_the_configured_version_commit_and_environment(self):
        with override_settings(
            APP_VERSION="9.9.9", DJANGO_GIT_SHA="deadbee", DJANGO_ENVIRONMENT="staging"
        ):
            response = self.client.get("/api/health/")

        data = response.json()
        self.assertEqual(data["version"], "9.9.9")
        self.assertEqual(data["commit"], "deadbee")
        self.assertEqual(data["environment"], "staging")

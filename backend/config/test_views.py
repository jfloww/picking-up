from django.test import TestCase


class HealthViewTests(TestCase):
    def test_get_returns_200_with_ok_status(self):
        response = self.client.get("/api/health/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_does_not_require_authentication(self):
        # DRF's DEFAULT_PERMISSION_CLASSES is IsAuthenticated project-wide;
        # this is a plain Django view specifically to stay outside that,
        # since infra health checks (Cloud Run, load balancers) can't
        # authenticate.
        response = self.client.get("/api/health/")

        self.assertNotEqual(response.status_code, 401)

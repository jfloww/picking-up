import logging
import re
from unittest import TestCase

from django.http import HttpResponse
from django.test import RequestFactory

from config.middleware import RequestIdLogFilter, RequestIdMiddleware, _request_id_var

_HEX32 = re.compile(r"^[0-9a-f]{32}$")


class RequestIdMiddlewareTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_generates_a_request_id_and_echoes_it_on_the_response(self):
        middleware = RequestIdMiddleware(lambda request: HttpResponse())
        response = middleware(self.factory.get("/"))

        self.assertIn("X-Request-Id", response)
        self.assertRegex(response["X-Request-Id"], _HEX32)

    def test_reuses_an_inbound_x_request_id_header_instead_of_generating_a_new_one(self):
        middleware = RequestIdMiddleware(lambda request: HttpResponse())
        response = middleware(self.factory.get("/", HTTP_X_REQUEST_ID="upstream-id-123"))

        self.assertEqual(response["X-Request-Id"], "upstream-id-123")

    def test_generates_a_different_id_for_each_request_with_no_inbound_header(self):
        middleware = RequestIdMiddleware(lambda request: HttpResponse())
        first = middleware(self.factory.get("/"))
        second = middleware(self.factory.get("/"))

        self.assertNotEqual(first["X-Request-Id"], second["X-Request-Id"])

    def test_the_id_is_available_to_a_log_call_made_while_get_response_runs(self):
        seen = {}

        def get_response(request):
            seen["request_id_during_handling"] = _request_id_var.get()
            return HttpResponse()

        middleware = RequestIdMiddleware(get_response)
        response = middleware(self.factory.get("/"))

        self.assertEqual(seen["request_id_during_handling"], response["X-Request-Id"])

    def test_resets_the_context_var_after_the_request_so_it_does_not_leak_into_the_next_one(self):
        middleware = RequestIdMiddleware(lambda request: HttpResponse())
        middleware(self.factory.get("/", HTTP_X_REQUEST_ID="first-request"))

        self.assertEqual(_request_id_var.get(), "-")

    def test_resets_the_context_var_even_when_get_response_raises(self):
        def get_response(request):
            raise RuntimeError("downstream failure")

        middleware = RequestIdMiddleware(get_response)
        with self.assertRaises(RuntimeError):
            middleware(self.factory.get("/", HTTP_X_REQUEST_ID="doomed-request"))

        self.assertEqual(_request_id_var.get(), "-")


class RequestIdLogFilterTests(TestCase):
    def _make_record(self) -> logging.LogRecord:
        return logging.LogRecord("test", logging.INFO, __file__, 1, "message", None, None)

    def test_attaches_the_current_request_id_to_the_record(self):
        token = _request_id_var.set("filter-test-id")
        try:
            record = self._make_record()
            result = RequestIdLogFilter().filter(record)
        finally:
            _request_id_var.reset(token)

        self.assertTrue(result)
        self.assertEqual(record.request_id, "filter-test-id")

    def test_attaches_the_placeholder_outside_any_request(self):
        record = self._make_record()
        RequestIdLogFilter().filter(record)

        self.assertEqual(record.request_id, "-")

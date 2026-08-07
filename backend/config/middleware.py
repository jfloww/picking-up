import contextvars
import logging
import uuid

_request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_id", default="-"
)


class RequestIdMiddleware:
    """Assigns a per-request correlation ID and makes it available to every
    log call made while handling that request, including ones deep in
    application code with no access to the request object.

    Honors an inbound X-Request-Id header when present, so a request already
    tagged upstream (by nginx, a load balancer, or a client) keeps the same
    ID through Django's own logs instead of getting a second, unrelated one.
    Echoes the ID back on the response so the caller can correlate its own
    logs against Django's.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request_id = request.headers.get("X-Request-Id") or uuid.uuid4().hex
        token = _request_id_var.set(request_id)
        try:
            response = self.get_response(request)
        finally:
            _request_id_var.reset(token)
        response["X-Request-Id"] = request_id
        return response


class RequestIdLogFilter(logging.Filter):
    """Attaches the current request's correlation ID to every log record.

    A logging.Filter, not a logging.Formatter field lookup, because the
    formatter only sees whatever attributes the record already has —
    something has to set `record.request_id` before formatting happens, for
    every logger in the tree, not just ones a request object is threaded
    into by hand.

    ContextVar (not threading.local) so this also works correctly if the
    project ever moves to an ASGI/async server — a thread-local would leak
    one request's ID into a concurrently-handled request sharing the same
    OS thread under an async runtime.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = _request_id_var.get()
        return True

from rest_framework.throttling import SimpleRateThrottle


class ClientIPRateThrottle(SimpleRateThrottle):
    """Throttle every request by client IP, including authenticated callers."""

    def get_cache_key(self, request, view):
        return self.cache_format % {
            "scope": self.scope,
            "ident": self.get_ident(request),
        }


class FirstFailureThrottleMixin:
    """Stop evaluating throttles once one has already rejected the request.

    DRF's default `APIView.check_throttles()` calls `allow_request()` on
    every configured throttle unconditionally, even after an earlier one
    has already failed. `allow_request()` records the attempt as a side
    effect whenever it returns True, so a request already rejected by the
    burst throttle would still be recorded against, and counted toward, the
    sustained throttle's daily budget. That makes a burst-limited flood of
    requests exhaust the daily limit far faster than the advertised rate
    implies (RF-018). Stopping at the first failure means only requests not
    already known to be rejected are ever recorded by a later throttle.
    """

    def check_throttles(self, request):
        # Stopping at the first failure means at most one throttle can ever
        # be the one that rejected the request, unlike DRF's default
        # implementation (which collects every failing throttle's wait time
        # before reducing them with max()). Call the same self.throttled()
        # extension point DRF's version does, rather than raising directly,
        # so a view that overrides throttled() for custom behavior isn't
        # silently bypassed by this mixin.
        for throttle in self.get_throttles():
            if not throttle.allow_request(request, self):
                self.throttled(request, throttle.wait())
                return


class LoginBurstThrottle(ClientIPRateThrottle):
    scope = "auth_login_burst"


class LoginSustainedThrottle(ClientIPRateThrottle):
    scope = "auth_login_sustained"


class RegisterBurstThrottle(ClientIPRateThrottle):
    scope = "auth_register_burst"


class RegisterSustainedThrottle(ClientIPRateThrottle):
    scope = "auth_register_sustained"


class GoogleBurstThrottle(ClientIPRateThrottle):
    scope = "auth_google_burst"


class GoogleSustainedThrottle(ClientIPRateThrottle):
    scope = "auth_google_sustained"

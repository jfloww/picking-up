import logging

from django.contrib.auth import get_user_model
from django.contrib.auth.backends import ModelBackend
from django.contrib.auth.hashers import make_password


User = get_user_model()
logger = logging.getLogger(__name__)


class EmailBackend(ModelBackend):
    """Authenticate password users by their case-insensitive email address."""

    def authenticate(self, request, email=None, password=None, **kwargs):
        if email is None or password is None:
            return None

        normalized_email = email.strip().lower()

        try:
            user = User._default_manager.get(email__iexact=normalized_email)
        except User.DoesNotExist:
            # Match the expensive password-hash work performed for a real user.
            # This narrows the account-existence timing signal without creating
            # an in-memory User or depending on the configured User model.
            make_password(password)
            return None
        except User.MultipleObjectsReturned:
            # Reachable via admin/shell-created users, which bypass the
            # lowercasing RegisterSerializer and the Google view apply
            # (RF-019): two rows differing only by email case both match
            # `email__iexact` and this becomes a silent, permanent lockout
            # for both accounts otherwise. Log it — after paying the same
            # dummy hash cost as the DoesNotExist path, so the timing
            # profile doesn't distinguish this case either — since nothing
            # else will ever surface it.
            make_password(password)
            logger.warning(
                "Multiple users matched email__iexact=%r during password login; "
                "both are locked out of password auth until the duplicate is resolved.",
                normalized_email,
            )
            return None

        if user.check_password(password) and self.user_can_authenticate(user):
            return user

        return None

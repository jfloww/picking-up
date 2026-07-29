from django.conf import settings
from django.db import models


# Django's built-in User model remains the account record for V1 — no
# custom AUTH_USER_MODEL. Google-specific fields live on a related model
# instead, since the built-in User can't be extended directly.
class GoogleIdentity(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="google_identity"
    )
    sub = models.CharField(max_length=255, unique=True)
    email = models.EmailField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"GoogleIdentity(user_id={self.user_id}, sub={self.sub})"

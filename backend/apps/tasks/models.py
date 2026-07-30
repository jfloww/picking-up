from django.conf import settings
from django.db import models


SCOPE_KIND_CHOICES = [
    ("day", "day"),
    ("week", "week"),
    ("month", "month"),
    ("year", "year"),
    ("bucket", "bucket"),
]


class Task(models.Model):
    id = models.UUIDField(primary_key=True, editable=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="tasks"
    )
    title = models.CharField(max_length=500)
    memo = models.TextField(blank=True, null=True)
    done = models.BooleanField(default=False)
    scope_kind = models.CharField(max_length=10, choices=SCOPE_KIND_CHOICES)
    scope_value = models.CharField(max_length=60)
    rolled_from_kind = models.CharField(
        max_length=10, blank=True, null=True, choices=SCOPE_KIND_CHOICES
    )
    rolled_from_value = models.CharField(max_length=20, blank=True, null=True)
    created_at = models.CharField(max_length=32)
    completed_at = models.CharField(max_length=32, blank=True, null=True)
    time = models.CharField(max_length=5, blank=True, null=True)
    due_date = models.CharField(max_length=10, blank=True, null=True)
    subtasks = models.JSONField(default=list, blank=True)
    repeat_weekdays = models.JSONField(blank=True, null=True)
    repeat_source = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="occurrences",
    )
    excluded_dates = models.JSONField(blank=True, null=True)
    priority = models.BooleanField(blank=True, null=True)
    duration_minutes = models.PositiveIntegerField(blank=True, null=True)
    background = models.BooleanField(blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]
        # No explicit index on `user` — a ForeignKey already implies
        # db_index=True, so an additional models.Index(fields=["user"])
        # here would be redundant. Harmless on SQLite (silently allowed),
        # but Oracle rejects creating a second index on an identical
        # column list with ORA-01408.

    def __str__(self):
        return self.title

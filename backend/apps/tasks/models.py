import unicodedata
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q


SCOPE_KIND_CHOICES = [
    ("day", "day"),
    ("week", "week"),
    ("month", "month"),
    ("year", "year"),
    ("bucket", "bucket"),
]

CATEGORY_NORMALIZED_NAME_MAX_LENGTH = 180


def normalize_category_name(value: str) -> str:
    """Return the stable, locale-independent key used for category identity."""
    return unicodedata.normalize("NFKC", value).strip().casefold()


class Category(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="categories"
    )
    name = models.CharField(max_length=60)
    normalized_name = models.CharField(
        max_length=CATEGORY_NORMALIZED_NAME_MAX_LENGTH,
        editable=False,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "normalized_name"],
                name="unique_normalized_category_name_per_user",
            ),
        ]

    def save(self, *args, **kwargs):
        self.name = self.name.strip()
        self.normalized_name = normalize_category_name(self.name)
        if len(self.normalized_name) > CATEGORY_NORMALIZED_NAME_MAX_LENGTH:
            raise ValidationError(
                {
                    "name": (
                        "The normalized category name exceeds the supported "
                        f"{CATEGORY_NORMALIZED_NAME_MAX_LENGTH}-character limit."
                    )
                }
            )
        update_fields = kwargs.get("update_fields")
        if update_fields is not None and "name" in update_fields:
            kwargs["update_fields"] = set(update_fields) | {"normalized_name"}
        return super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Task(models.Model):
    id = models.UUIDField(primary_key=True, editable=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="tasks"
    )
    title = models.CharField(max_length=500)
    memo = models.TextField(blank=True, null=True)
    done = models.BooleanField(default=False)
    scope_kind = models.CharField(max_length=10, choices=SCOPE_KIND_CHOICES)
    scope_value = models.CharField(max_length=60, blank=True)
    bucket_category = models.ForeignKey(
        Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="tasks"
    )
    rolled_from_kind = models.CharField(
        max_length=10, blank=True, null=True, choices=SCOPE_KIND_CHOICES
    )
    rolled_from_value = models.CharField(max_length=20, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
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
    order = models.FloatField(default=0)
    version = models.PositiveBigIntegerField(default=1, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]
        # No explicit index on `user` — a ForeignKey already implies
        # db_index=True, so an additional models.Index(fields=["user"])
        # here would be redundant. Harmless on SQLite (silently allowed),
        # but Oracle rejects creating a second index on an identical
        # column list with ORA-01408.
        #
        # RF-006 round 2: two of the ten cross-field domain rules enforced
        # at the serializer layer (apps/tasks/serializers.py's
        # TaskSerializer.validate()) are also cheap, portable enough to add
        # as CheckConstraints — defense-in-depth below the serializer, the
        # same reasoning as Category's UniqueConstraint above. The rest
        # (date/time format regexes, list bounds/dedup, the rolled-from
        # bucket rejection, subtask uniqueness) either need per-kind regex
        # matching Django's CHECK constraints can't portably express across
        # SQLite/PostgreSQL/Oracle, or reach into JSONField contents, so
        # they stay serializer-only. See
        # docs/refining/2026-08-06-domain-validation.md for the full
        # rule-by-rule breakdown.
        constraints = [
            models.CheckConstraint(
                check=(
                    (Q(scope_kind="bucket") & Q(bucket_category__isnull=False))
                    | (~Q(scope_kind="bucket") & Q(bucket_category__isnull=True))
                ),
                name="bucket_category_set_iff_scope_kind_is_bucket",
            ),
            models.CheckConstraint(
                check=~(Q(repeat_weekdays__isnull=False) & Q(repeat_source__isnull=False)),
                name="repeat_weekdays_and_repeat_source_are_mutually_exclusive",
            ),
        ]

    def __str__(self):
        return self.title

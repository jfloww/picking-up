import re

from django.utils import timezone
from rest_framework import serializers

from .models import (
    CATEGORY_NORMALIZED_NAME_MAX_LENGTH,
    SCOPE_KIND_CHOICES,
    Category,
    Task,
    normalize_category_name,
)


SUBTASK_ID_MAX_LENGTH = 255
SUBTASK_TITLE_MAX_LENGTH = 500

# RF-006 domain validation (round 2): defensive, operational caps on the two
# unbounded JSONField collections on Task. Nothing in the product spec or the
# frontend derives a specific number for either — these exist purely so a
# client bug or a malicious/misbehaving caller can't grow a single row's JSON
# payload without limit. Picked generous (an order of magnitude past any
# realistic real-world task) so no legitimate use ever hits them. Kept as
# module constants, same pattern as SUBTASK_ID_MAX_LENGTH above, so they're
# easy to find and retune later if that judgment call turns out wrong.
SUBTASKS_MAX_COUNT = 200
EXCLUDED_DATES_MAX_COUNT = 200

# YYYY-MM-DD, YYYY-MM, and YYYY-MM-YYYY formats used by scope_value/
# rolled_from_value per scope_kind (see Task/Scope's frontend-authoritative
# comments in frontend/src/features/tasks/types.ts and the scopeValueOf/
# scopeFromParts mapping in frontend/src/features/tasks/api/mapping.ts).
# "week" carries the week's start date, same YYYY-MM-DD shape as "day".
_DATE_VALUE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MONTH_VALUE_PATTERN = re.compile(r"^\d{4}-\d{2}$")
_YEAR_VALUE_PATTERN = re.compile(r"^\d{4}$")
SCOPE_VALUE_PATTERNS = {
    "day": _DATE_VALUE_PATTERN,
    "week": _DATE_VALUE_PATTERN,
    "month": _MONTH_VALUE_PATTERN,
    "year": _YEAR_VALUE_PATTERN,
}

# "HH:MM", 24h, zero-padded (frontend/src/features/tasks/types.ts's `time`
# comment).
_TIME_PATTERN = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


class SubtaskSerializer(serializers.Serializer):
    # Truncate rather than reject (RF-006 review finding): the generic Task
    # PUT always resends the whole subtasks array, so a hard `max_length`
    # rejection here would make any task holding one over-length subtask —
    # new or a pre-limit legacy row — permanently un-editable on every
    # future write, and would leave a legacy-localStorage task stuck
    # retrying the migration-upload loop forever. Truncating preserves the
    # underlying safety goal (nothing this API stores can later fail to
    # materialize into a Task via Promote) without that failure mode.
    # Existing DB rows get the same treatment once via migration 0014.
    id = serializers.CharField(allow_blank=False)
    title = serializers.CharField(allow_blank=False)
    done = serializers.BooleanField()

    def validate_id(self, value: str) -> str:
        return value[:SUBTASK_ID_MAX_LENGTH]

    def validate_title(self, value: str) -> str:
        return value[:SUBTASK_TITLE_MAX_LENGTH]


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ("id", "name", "created_at")
        read_only_fields = ("id", "created_at")

    def validate_name(self, value):
        name = value.strip()
        if not name:
            raise serializers.ValidationError("This field may not be blank.")

        normalized_name = normalize_category_name(name)
        if len(normalized_name) > CATEGORY_NORMALIZED_NAME_MAX_LENGTH:
            raise serializers.ValidationError(
                "The normalized category name exceeds the supported "
                f"{CATEGORY_NORMALIZED_NAME_MAX_LENGTH}-character limit."
            )

        request = self.context.get("request")
        if self.instance is not None and request is not None and request.user.is_authenticated:
            conflict = (
                Category.objects.filter(
                    user=request.user,
                    normalized_name=normalized_name,
                )
                .exclude(pk=self.instance.pk)
                .exists()
            )
            if conflict:
                raise serializers.ValidationError("A category with this name already exists.")
        return name


class TaskSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField()
    memo = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    done = serializers.BooleanField(required=False, default=False)
    bucket_category = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.none(), allow_null=True, required=False, default=None,
        pk_field=serializers.UUIDField(),
    )
    rolled_from_kind = serializers.ChoiceField(
        choices=SCOPE_KIND_CHOICES, required=False, allow_null=True, allow_blank=True, default=None,
    )
    rolled_from_value = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, default=None, max_length=20,
    )
    time = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, default=None, max_length=5,
    )
    due_date = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, default=None, max_length=10,
    )
    subtasks = SubtaskSerializer(many=True, required=False, default=list)
    repeat_weekdays = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=6),
        required=False, allow_null=True, default=None,
    )
    repeat_source = serializers.PrimaryKeyRelatedField(
        queryset=Task.objects.none(), allow_null=True, required=False, default=None,
    )
    excluded_dates = serializers.ListField(
        child=serializers.CharField(), required=False, allow_null=True, default=None,
    )
    priority = serializers.BooleanField(required=False, allow_null=True, default=None)
    duration_minutes = serializers.IntegerField(
        required=False, allow_null=True, default=None, min_value=0,
    )
    background = serializers.BooleanField(required=False, allow_null=True, default=None)
    order = serializers.FloatField(required=False, default=0.0)

    class Meta:
        model = Task
        fields = (
            "id",
            "title",
            "memo",
            "done",
            "scope_kind",
            "scope_value",
            "bucket_category",
            "rolled_from_kind",
            "rolled_from_value",
            "created_at",
            "completed_at",
            "time",
            "due_date",
            "subtasks",
            "repeat_weekdays",
            "repeat_source",
            "excluded_dates",
            "priority",
            "duration_minutes",
            "background",
            "order",
            "version",
        )
        read_only_fields = ("created_at", "completed_at", "version")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request is not None and request.user.is_authenticated:
            self.fields["repeat_source"].queryset = Task.objects.filter(user=request.user)
            self.fields["bucket_category"].queryset = Category.objects.filter(user=request.user)

    def validate_id(self, value):
        # Only enforced on create. On update, `id` is immutable (see
        # `update()` below) and gets discarded regardless of what's sent, so
        # checking it against existing rows here would reject legitimate PUTs
        # whenever the body happens to carry someone else's id — exactly the
        # attack `update()` already neutralizes by ignoring it outright.
        if self.instance is None and Task.objects.filter(id=value).exists():
            raise serializers.ValidationError("A task with this id already exists.")
        return value

    def validate_subtasks(self, value):
        if len(value) > SUBTASKS_MAX_COUNT:
            raise serializers.ValidationError(
                f"A task cannot hold more than {SUBTASKS_MAX_COUNT} subtasks."
            )
        ids = [subtask["id"] for subtask in value]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("subtasks must not contain duplicate ids.")
        return value

    def validate_time(self, value):
        if value and not _TIME_PATTERN.fullmatch(value):
            raise serializers.ValidationError('time must be in 24-hour "HH:MM" format.')
        return value

    def validate_due_date(self, value):
        if value and not _DATE_VALUE_PATTERN.fullmatch(value):
            raise serializers.ValidationError('due_date must be in "YYYY-MM-DD" format.')
        return value

    def validate_repeat_weekdays(self, value):
        # Per-item 0-6 bounds are already enforced by the ListField's child
        # IntegerField(min_value=0, max_value=6). This adds the two rules
        # that need the whole list: non-empty when present (a `[]` anchor
        # would repeat on no day, which is meaningless — treat it the same
        # as "not repeating," i.e. null), and no duplicate weekdays.
        if value is not None:
            if len(value) == 0:
                raise serializers.ValidationError(
                    "repeat_weekdays must be a non-empty list, or null."
                )
            if len(set(value)) != len(value):
                raise serializers.ValidationError(
                    "repeat_weekdays must not contain duplicate weekdays."
                )
        return value

    def validate_excluded_dates(self, value):
        if value:
            if len(value) > EXCLUDED_DATES_MAX_COUNT:
                raise serializers.ValidationError(
                    f"excluded_dates cannot hold more than {EXCLUDED_DATES_MAX_COUNT} entries."
                )
            if len(set(value)) != len(value):
                raise serializers.ValidationError("excluded_dates must not contain duplicate dates.")
            if any(not _DATE_VALUE_PATTERN.fullmatch(date) for date in value):
                raise serializers.ValidationError(
                    'Every excluded_dates entry must be in "YYYY-MM-DD" format.'
                )
        return value

    def validate(self, attrs):
        # Cross-field domain rules (RF-006 round 2). `attrs` only contains
        # fields present in this request — full on create/PUT (every field
        # above declares an explicit serializer-level default), but partial
        # on PATCH. Fall back to the current instance for anything missing
        # so a PATCH that only touches one field is still checked against
        # the row's real resulting state, not just the fields it happened
        # to send.
        def current(field_name):
            if field_name in attrs:
                return attrs[field_name]
            if self.instance is not None:
                return getattr(self.instance, field_name)
            return None

        scope_kind = current("scope_kind")
        scope_value = current("scope_value") or ""
        bucket_category = current("bucket_category")
        rolled_from_kind = current("rolled_from_kind")
        rolled_from_value = current("rolled_from_value")
        repeat_weekdays = current("repeat_weekdays")
        repeat_source = current("repeat_source")
        excluded_dates = current("excluded_dates")
        due_date = current("due_date")
        duration_minutes = current("duration_minutes")
        time_value = current("time")

        errors = {}

        # Rule 1: scope_value format must match scope_kind. Bucket scope
        # never puts real data on the wire in scope_value (mapping.ts's
        # scopeValueOf) — it must be empty; every other kind must match its
        # per-kind date format.
        if scope_kind == "bucket":
            if scope_value:
                errors["scope_value"] = 'scope_value must be empty ("") for bucket-scoped tasks.'
        elif scope_kind in SCOPE_VALUE_PATTERNS and not SCOPE_VALUE_PATTERNS[scope_kind].fullmatch(scope_value):
            errors["scope_value"] = f"scope_value does not match the expected format for scope_kind={scope_kind!r}."

        # Rule 2: bucket_category <-> scope_kind pairing (mapping.ts:
        # `bucket_category: task.scope.kind === "bucket" ? task.scope.categoryId : null`).
        if scope_kind == "bucket":
            if bucket_category is None:
                errors["bucket_category"] = "bucket_category is required when scope_kind is bucket."
        elif bucket_category is not None:
            errors["bucket_category"] = "bucket_category must be null unless scope_kind is bucket."

        # Rule 3: rolled_from_kind/rolled_from_value pairing. Both null or
        # both set; when set, same per-kind format as rule 1; "bucket" is
        # rejected outright — mapping.ts documents that nothing in this app
        # ever rolls a bucket-scoped task over, so treat it as an invalid
        # domain state rather than a type-legal-but-unreachable one. (Judgment
        # call — see the PR description if this needs revisiting.)
        if bool(rolled_from_kind) != bool(rolled_from_value):
            errors["rolled_from_kind"] = (
                "rolled_from_kind and rolled_from_value must both be set or both be null."
            )
        elif rolled_from_kind:
            if rolled_from_kind == "bucket":
                errors["rolled_from_kind"] = (
                    "rolled_from_kind cannot be bucket — nothing in this app rolls over a "
                    "bucket-scoped task."
                )
            elif not SCOPE_VALUE_PATTERNS[rolled_from_kind].fullmatch(rolled_from_value):
                errors["rolled_from_value"] = (
                    f"rolled_from_value does not match the expected format for "
                    f"rolled_from_kind={rolled_from_kind!r}."
                )

        # Rule 4: repeat_weekdays / repeat_source are mutually exclusive — a
        # task is either the anchor (repeat_weekdays) or a generated
        # occurrence (repeat_source), never both. services.py's nest_task
        # already assumes this holds (`if source.repeat_weekdays or
        # source.repeat_source_id`); this is what actually enforces it.
        if repeat_weekdays and repeat_source is not None:
            errors["repeat_weekdays"] = "repeat_weekdays and repeat_source cannot both be set."

        # Rule 6: excluded_dates is only meaningful on the anchor task.
        if excluded_dates and not repeat_weekdays:
            errors["excluded_dates"] = "excluded_dates requires repeat_weekdays to be set."

        # Rule 7: due_date is excluded for routine-managed tasks (anchor or
        # occurrence) — "unset for routine tasks" per the frontend type
        # comment.
        if due_date and (repeat_weekdays or repeat_source is not None):
            errors["due_date"] = "due_date must be null when repeat_weekdays or repeat_source is set."

        # Rule 8: duration_minutes is only meaningful alongside `time`.
        if duration_minutes is not None and not time_value:
            errors["duration_minutes"] = "duration_minutes requires time to also be set."

        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    def create(self, validated_data):
        if validated_data.get("done"):
            validated_data["completed_at"] = timezone.now()
        return super().create(validated_data)

    def update(self, instance, validated_data):
        # `id` is identity, not a mutable field — the URL's pk is authoritative
        # on PUT. Without this, DRF's default ModelSerializer.update() would
        # setattr(instance, "id", <body's id>) and instance.save() would then
        # UPDATE ... WHERE id = <that other id>, silently overwriting
        # whatever row already has that id (see task-1 security review).
        validated_data.pop("id", None)
        if "done" in validated_data and validated_data["done"] != instance.done:
            validated_data["completed_at"] = timezone.now() if validated_data["done"] else None
        validated_data["version"] = instance.version + 1
        return super().update(instance, validated_data)


class NestTaskCommandSerializer(serializers.Serializer):
    target_id = serializers.UUIDField()
    source_version = serializers.IntegerField(min_value=1)
    target_version = serializers.IntegerField(min_value=1)
    subtask_id = serializers.CharField(max_length=255, allow_blank=False)
    confirm_data_loss = serializers.BooleanField(default=False)


class PromoteSubtaskCommandSerializer(serializers.Serializer):
    subtask_id = serializers.CharField(max_length=255, allow_blank=False)
    parent_version = serializers.IntegerField(min_value=1)
    new_task_id = serializers.UUIDField()


class DetachTaskCommandSerializer(serializers.Serializer):
    occurrence_version = serializers.IntegerField(min_value=1)
    repeat_weekdays = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=6),
        required=False, allow_null=True, default=None,
    )


class DeleteOccurrenceCommandSerializer(serializers.Serializer):
    occurrence_version = serializers.IntegerField(min_value=1)


class RescheduleTaskCommandSerializer(serializers.Serializer):
    task_version = serializers.IntegerField(min_value=1)
    date = serializers.CharField(max_length=10)

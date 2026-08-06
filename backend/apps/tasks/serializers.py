from django.utils import timezone
from rest_framework import serializers

from .models import SCOPE_KIND_CHOICES, Category, Task


class SubtaskSerializer(serializers.Serializer):
    id = serializers.CharField()
    title = serializers.CharField()
    done = serializers.BooleanField()


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ("id", "name", "created_at")
        read_only_fields = ("id", "created_at")


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
        )
        read_only_fields = ("created_at", "completed_at")

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
        return super().update(instance, validated_data)

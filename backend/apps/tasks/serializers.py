from rest_framework import serializers

from .models import Task


class TaskSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField()
    repeat_source = serializers.PrimaryKeyRelatedField(
        queryset=Task.objects.none(), allow_null=True, required=False
    )

    class Meta:
        model = Task
        fields = (
            "id",
            "title",
            "memo",
            "done",
            "scope_kind",
            "scope_value",
            "rolled_from_kind",
            "rolled_from_value",
            "created_at",
            "completed_at",
            "time",
            "subtasks",
            "repeat_weekdays",
            "repeat_source",
            "excluded_dates",
            "priority",
            "duration_minutes",
            "background",
        )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request is not None and request.user.is_authenticated:
            self.fields["repeat_source"].queryset = Task.objects.filter(user=request.user)

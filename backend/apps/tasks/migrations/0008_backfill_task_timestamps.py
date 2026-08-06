import logging
from datetime import timezone as dt_timezone

from django.db import migrations
from django.utils.dateparse import parse_datetime

logger = logging.getLogger(__name__)


def backfill_timestamps(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")

    for task in Task.objects.all():
        created = parse_datetime(task.created_at or "")
        if created is None:
            logger.warning(
                "Task %s: unparseable created_at %r, falling back to updated_at",
                task.id, task.created_at,
            )
            created = task.updated_at
        elif created.tzinfo is None:
            created = created.replace(tzinfo=dt_timezone.utc)
        task.created_at_dt = created

        if task.completed_at:
            completed = parse_datetime(task.completed_at)
            if completed is None:
                logger.warning(
                    "Task %s: unparseable completed_at %r, falling back to updated_at",
                    task.id, task.completed_at,
                )
                completed = task.updated_at
            elif completed.tzinfo is None:
                completed = completed.replace(tzinfo=dt_timezone.utc)
            task.completed_at_dt = completed
        else:
            task.completed_at_dt = None

        task.save(update_fields=["created_at_dt", "completed_at_dt"])


class Migration(migrations.Migration):

    dependencies = [
        ("tasks", "0007_task_timestamps_shadow_fields"),
    ]

    operations = [
        migrations.RunPython(backfill_timestamps, migrations.RunPython.noop),
    ]

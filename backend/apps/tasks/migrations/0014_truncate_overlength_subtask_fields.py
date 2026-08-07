import logging

from django.db import migrations

logger = logging.getLogger(__name__)

# Must match SubtaskSerializer's SUBTASK_ID_MAX_LENGTH/SUBTASK_TITLE_MAX_LENGTH
# in apps/tasks/serializers.py. Not imported — migrations must stay isolated
# from app code that can change independently of the historical schema.
SUBTASK_ID_MAX_LENGTH = 255
SUBTASK_TITLE_MAX_LENGTH = 500


def truncate_overlength_subtask_fields(apps, schema_editor):
    # SubtaskSerializer previously had no length limit on subtask id/title.
    # A later change (RF-006) added one, enforced by truncating on write
    # rather than rejecting — but truncate-on-write only touches a subtask
    # the next time it's written. Any task holding an over-length subtask
    # from before that change would otherwise sit at its old length
    # indefinitely, since nothing forces a write. This is a one-time sweep
    # so no such row is left behind by this migration; going forward,
    # every write already normalizes at the serializer.
    Task = apps.get_model("tasks", "Task")

    for task in Task.objects.exclude(subtasks=[]).iterator():
        subtasks = task.subtasks or []
        truncated = []
        changed = False

        for subtask in subtasks:
            if not isinstance(subtask, dict):
                truncated.append(subtask)
                continue

            new_subtask = dict(subtask)

            subtask_id = subtask.get("id")
            if isinstance(subtask_id, str) and len(subtask_id) > SUBTASK_ID_MAX_LENGTH:
                new_subtask["id"] = subtask_id[:SUBTASK_ID_MAX_LENGTH]
                changed = True
                logger.warning(
                    "Task %s: truncated over-length subtask id (%d chars) to %d.",
                    task.id, len(subtask_id), SUBTASK_ID_MAX_LENGTH,
                )

            title = subtask.get("title")
            if isinstance(title, str) and len(title) > SUBTASK_TITLE_MAX_LENGTH:
                new_subtask["title"] = title[:SUBTASK_TITLE_MAX_LENGTH]
                changed = True
                logger.warning(
                    "Task %s: truncated over-length subtask title (%d chars) to %d.",
                    task.id, len(title), SUBTASK_TITLE_MAX_LENGTH,
                )

            truncated.append(new_subtask)

        if not changed:
            continue

        # Two distinct original ids that happen to share the same first
        # 255 characters would collide after truncation. Vanishingly
        # unlikely (ids are client-generated UUIDs in practice) and not
        # itself destructive — the existing "ambiguous duplicate subtask
        # id" handling in the promote command already exists to handle
        # exactly this shape safely — but worth a log line to find if it
        # ever happens.
        ids = [item.get("id") for item in truncated if isinstance(item, dict)]
        if len(ids) != len(set(ids)):
            logger.warning(
                "Task %s: subtask id truncation produced a duplicate id.",
                task.id,
            )

        task.subtasks = truncated
        task.save(update_fields=["subtasks"])


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0013_task_version"),
    ]

    operations = [
        migrations.RunPython(truncate_overlength_subtask_fields, migrations.RunPython.noop),
    ]

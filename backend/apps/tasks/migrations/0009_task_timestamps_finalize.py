from django.db import migrations, models


def backfill_stragglers(apps, schema_editor):
    # Deploys restart gunicorn only after `migrate` finishes, so the old
    # server process (still writing the old string `created_at` column) can
    # insert a new Task row in the window between 0008's backfill running
    # and this migration running. That row's `created_at_dt` shadow column
    # would be NULL, which would make the AlterField below (making
    # `created_at` NOT NULL) fail — and on Oracle, DDL auto-commits, so the
    # RemoveField ops preceding it in this same migration would already be
    # committed by the time that failure happens, destroying the original
    # string data with no clean way to retry. Re-run the same
    # updated_at-fallback used by 0008 here, defensively, to catch any such
    # race-window rows before the schema changes below run.
    Task = apps.get_model("tasks", "Task")
    Task.objects.filter(created_at_dt__isnull=True).update(created_at_dt=models.F("updated_at"))


class Migration(migrations.Migration):

    dependencies = [
        ("tasks", "0008_backfill_task_timestamps"),
    ]

    operations = [
        migrations.RunPython(backfill_stragglers, migrations.RunPython.noop),
        # RemoveField must run before RenameField: the old string columns
        # are still occupying the `created_at`/`completed_at` names, so
        # those names have to be freed before the shadow `_dt` columns can
        # be renamed into them.
        migrations.RemoveField(model_name="task", name="created_at"),
        migrations.RemoveField(model_name="task", name="completed_at"),
        migrations.RenameField(model_name="task", old_name="created_at_dt", new_name="created_at"),
        migrations.RenameField(model_name="task", old_name="completed_at_dt", new_name="completed_at"),
        migrations.AlterField(
            model_name="task",
            name="created_at",
            field=models.DateTimeField(auto_now_add=True),
        ),
        migrations.AlterField(
            model_name="task",
            name="completed_at",
            field=models.DateTimeField(null=True, blank=True),
        ),
    ]

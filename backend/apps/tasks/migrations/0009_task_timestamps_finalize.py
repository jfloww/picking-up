from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tasks", "0008_backfill_task_timestamps"),
    ]

    operations = [
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

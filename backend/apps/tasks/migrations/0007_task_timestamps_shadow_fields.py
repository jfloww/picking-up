from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tasks", "0006_task_order"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="created_at_dt",
            field=models.DateTimeField(null=True, blank=True),
        ),
        migrations.AddField(
            model_name="task",
            name="completed_at_dt",
            field=models.DateTimeField(null=True, blank=True),
        ),
    ]

from django.db import migrations, models


def backfill_order(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    for index, task in enumerate(Task.objects.order_by("created_at", "id")):
        Task.objects.filter(pk=task.pk).update(order=index)


class Migration(migrations.Migration):

    dependencies = [
        ("tasks", "0005_backfill_bucket_categories"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="order",
            field=models.FloatField(default=0),
        ),
        migrations.RunPython(backfill_order, migrations.RunPython.noop),
    ]

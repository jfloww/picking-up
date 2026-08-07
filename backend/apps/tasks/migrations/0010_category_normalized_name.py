from django.db import migrations, models


class Migration(migrations.Migration):
    # Oracle DDL auto-commits. Keep this migration to one schema operation so
    # a later data-backfill failure cannot leave an added column inside an
    # otherwise-unapplied mixed DDL/data migration.
    atomic = False

    dependencies = [
        ("tasks", "0009_task_timestamps_finalize"),
    ]

    operations = [
        migrations.AddField(
            model_name="category",
            name="normalized_name",
            field=models.CharField(editable=False, max_length=180, null=True),
        ),
    ]

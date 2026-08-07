from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0012_category_normalized_name_finalize"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="version",
            field=models.PositiveBigIntegerField(default=1, editable=False),
        ),
    ]

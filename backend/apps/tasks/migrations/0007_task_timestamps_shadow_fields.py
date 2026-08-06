from django.db import migrations, models


# `created_at`/`completed_at` start life as string columns (CharField) and
# need to become real DateTimeFields. A bare AlterField can't do this
# safely: there's no reliable string->datetime conversion path, and DB
# backends (Oracle in particular, which this app runs against in
# production) don't implicitly cast free-form text to a temporal type the
# way SQLite might. So the conversion goes through parallel nullable shadow
# columns (added here), backfilled by explicit Python parsing (0008), and
# only then swapped into place (0009) — each step independently safe and
# reversible.
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

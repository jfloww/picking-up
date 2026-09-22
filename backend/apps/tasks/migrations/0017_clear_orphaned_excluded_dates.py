from django.db import migrations
from django.db.models import F
from django.utils import timezone


def clear_orphaned_excluded_dates(apps, schema_editor):
    """Remove exclusions left behind when an existing routine was ended.

    Migration 0017 follows the routine-ending behavior introduced after 0016.
    That command cleared ``repeat_weekdays`` without clearing
    ``excluded_dates``. Such rows could be read, but TaskSerializer rejected
    every later full update because exclusions are meaningful only while a
    repeat schedule exists.

    Bump the concurrency token with the repair so a client holding the old
    representation cannot pass If-Match and silently restore stale state.
    """

    Task = apps.get_model("tasks", "Task")
    Task.objects.filter(
        repeat_weekdays__isnull=True,
        excluded_dates__isnull=False,
    ).update(
        excluded_dates=None,
        version=F("version") + 1,
        updated_at=timezone.now(),
    )


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0016_focussettings"),
    ]

    operations = [
        migrations.RunPython(
            clear_orphaned_excluded_dates,
            migrations.RunPython.noop,
        ),
    ]

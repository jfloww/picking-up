import unicodedata

from django.db import migrations


MAX_NORMALIZED_NAME_LENGTH = 180


def normalize_name(value):
    return unicodedata.normalize("NFKC", value or "").strip().casefold()


def normalized_key(category):
    key = normalize_name(category.name)
    if len(key) > MAX_NORMALIZED_NAME_LENGTH:
        raise RuntimeError(
            "Category "
            f"{category.pk} normalizes to {len(key)} characters; "
            f"the supported maximum is {MAX_NORMALIZED_NAME_LENGTH}."
        )
    return key


def backfill_normalized_names(apps, schema_editor):
    Category = apps.get_model("tasks", "Category")
    Task = apps.get_model("tasks", "Task")
    survivors = {}

    categories = Category.objects.order_by("user_id", "created_at", "id").iterator()
    for category in categories:
        key = normalized_key(category)
        survivor = survivors.get((category.user_id, key))
        if survivor is None:
            Category.objects.filter(pk=category.pk).update(normalized_name=key)
            survivors[(category.user_id, key)] = category
            continue

        Task.objects.filter(bucket_category_id=category.pk).update(
            bucket_category_id=survivor.pk,
        )
        category.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0010_category_normalized_name"),
    ]

    # This migration contains only the data step. It is atomic on databases
    # that support transactions and is retried independently of AddField.
    operations = [
        migrations.RunPython(
            backfill_normalized_names,
            migrations.RunPython.noop,
            atomic=True,
        ),
    ]

import unicodedata

from django.db import migrations, models


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


def merge_stragglers(apps, schema_editor):
    # Re-run the complete deterministic merge immediately before constraints
    # are finalized. This covers both NULL rows and casefold-equivalent rows
    # inserted by an old writer between the backfill and the maintenance
    # cutover; merely filling NULL would let UNIQUE creation fail.
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
    # Oracle cannot roll DDL back. The data operation is explicitly atomic and
    # idempotent, while the AddField lives in 0010 and the primary backfill in
    # 0011, so a data failure cannot strand an unrecorded schema addition.
    atomic = False

    dependencies = [
        ("tasks", "0011_category_normalized_name_backfill"),
    ]

    operations = [
        migrations.RunPython(
            merge_stragglers,
            migrations.RunPython.noop,
            atomic=True,
        ),
        migrations.AlterField(
            model_name="category",
            name="normalized_name",
            field=models.CharField(editable=False, max_length=180),
        ),
        migrations.RemoveConstraint(
            model_name="category",
            name="unique_category_name_per_user",
        ),
        migrations.AddConstraint(
            model_name="category",
            constraint=models.UniqueConstraint(
                fields=("user", "normalized_name"),
                name="unique_normalized_category_name_per_user",
            ),
        ),
    ]

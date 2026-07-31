from django.db import migrations


def backfill_categories(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    Category = apps.get_model("tasks", "Category")

    bucket_tasks = Task.objects.filter(scope_kind="bucket").order_by("created_at")

    # user_id -> { lowercased name -> Category instance }
    categories_by_user: dict[int, dict[str, object]] = {}

    for task in bucket_tasks:
        raw_name = (task.scope_value or "").strip()
        if not raw_name:
            continue
        key = raw_name.lower()
        user_categories = categories_by_user.setdefault(task.user_id, {})
        category = user_categories.get(key)
        if category is None:
            # `bucket_tasks` is ordered by created_at, so the first task
            # encountered for a given (user, lowercased name) pair carries
            # the casing every later duplicate should defer to — matching
            # the app's existing case-insensitive-reuse rule.
            category = Category.objects.create(user_id=task.user_id, name=raw_name)
            user_categories[key] = category
        task.bucket_category = category
        task.save(update_fields=["bucket_category"])


def noop_reverse(apps, schema_editor):
    # Deliberately irreversible in a data-losing sense (bucket_category is
    # nulled by Task.bucket_category's on_delete=SET_NULL if Category rows
    # are removed by a real reversal), but Django requires *something*
    # runnable to keep this migration in the reversible chain for tooling
    # like `migrate <app> <earlier>` — reversing does nothing rather than
    # silently destroying data.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0004_category_and_bucket_category_fk"),
    ]

    operations = [
        migrations.RunPython(backfill_categories, noop_reverse),
    ]

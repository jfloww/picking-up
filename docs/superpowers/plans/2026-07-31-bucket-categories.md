# Bucket Categories as a First-Class Entity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn bucket-list categories from a free-text string derived from tasks into a persistent, owner-scoped `Category` entity — with rename support, empty categories that survive, and an explicit create action — while keeping the existing Bucket List page (reached via the "Bucket List" tab) fully functional throughout.

**Architecture:** A new `Category` Django model (own table, unique-per-user name) that `Task` references via a new `bucket_category` FK instead of the free-text `scope_value` string it used for bucket-scoped tasks before. A small dedicated REST API (list/create/rename) backs it, proxied through the existing Next.js BFF pattern. On the frontend, `Scope`'s bucket variant becomes `{ kind: "bucket"; categoryId: string }`; the store gains a `categories` slice fetched alongside tasks; and the category picker (both in the drawer and the item composer) becomes a `<select>` over real categories with an inline "+ New category…" creation flow, replacing the old free-text-with-datalist input that implicitly created categories by typing.

**Tech Stack:** Django 5 / DRF (backend), Next.js 15 / React 19 / TypeScript (frontend) — same stack as the rest of the app, no new dependencies.

## Global Constraints

- No delete endpoint or UI for categories in this plan — an unwanted empty category just sits there unused. (Design spec's explicit non-goal.)
- No manual category reordering — display order is always the category's own `created_at`, ascending. Never derived from task data.
- Category name uniqueness is per-user and case-insensitive: creating or renaming to a name that case-insensitively matches an existing category returns/reuses that existing category rather than erroring (for create) or is rejected (for rename — you can't rename into a collision).
- `bucket_category` is server-authoritative: the frontend never generates a category's id. Unlike `Task.id` (client-generated UUID, offline-first optimistic creation), category creation is **awaited**, not optimistic — the create-or-reuse semantics mean a client-generated id could be wrong (the server might return a different, pre-existing category), so `createCategory` resolves only after the server responds.
- `Scope`'s bucket variant carries `categoryId` only — never a denormalized category name. Every place that needs a category's display name resolves it from the loaded `categories` list, so a rename is instantly reflected everywhere with no cache to invalidate.
- This plan does **not** touch Daily/Weekly/Monthly views, navigation, or the Bucket List page's overall layout/visual design — only what's needed to swap the category data model underneath the page that already exists. A sidebar/page redesign (motivated by a separate reference design) is an explicitly separate, later plan that depends on this one.
- `lib/categories.ts`'s `resolveCategoryCasing`, `normalizeCategoryInput`, and `bucketCategoriesInUse` become dead code once category identity is by id, not string-matching — remove them (and their tests) rather than leaving them unused.
- The "+ New category…" flow shipped in this plan is deliberately minimal/utilitarian (a plain inline text input inside the category `<select>`'s own component) — it exists only so removing the old implicit-creation-by-typing behavior isn't a functional regression. Its visual placement is not final; a later page-redesign plan may replace it. Category **rename**, by contrast, is a net-new capability with no prior UI at all — this plan ships the store action and API fully tested, but does not need a UI trigger for it (not a regression to omit one).

---

### Task 1: Backend — `Category` model, `Task.bucket_category`, schema migration

**Files:**
- Modify: `backend/apps/tasks/models.py`
- Create: `backend/apps/tasks/migrations/0004_category_and_bucket_category_fk.py`
- Modify: `backend/apps/tasks/tests.py`

**Interfaces:**
- Produces: `Category` model (`id: UUID`, `user: FK(User)`, `name: str, max_length=60`, `created_at: DateTimeField(auto_now_add=True)`), unique per `(user, name)` at the DB level (case-sensitive backstop; case-insensitive matching is enforced at the API layer in Task 3). `Task.bucket_category`: nullable `FK(Category, on_delete=SET_NULL, related_name="tasks")`, used only when `scope_kind == "bucket"`. `Task.scope_value` becomes `blank=True` (no longer required for bucket-scoped tasks; existing day/week/month/year tasks are unaffected since the application layer still always supplies a real value for those).

- [ ] **Step 1: Write the failing tests**

Replace the two existing bucket tests in `backend/apps/tasks/tests.py` (they currently assert on `scope_value` for bucket tasks, which is no longer how bucket categories are represented) and add model-level uniqueness tests. Replace the `BucketScopeTests` class (currently at the end of the file) with:

```python
class BucketScopeTests(TestCase):
    def test_creates_and_fetches_a_bucket_scoped_task(self):
        owner, client = auth_client("bucket@example.com")
        category = Category.objects.create(user=owner, name="To Eat")
        payload = make_task_payload(scope_kind="bucket", scope_value="", bucket_category=str(category.id))
        response = client.post("/api/tasks/", payload, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["scope_kind"], "bucket")
        self.assertEqual(response.data["bucket_category"], str(category.id))

        get_response = client.get("/api/tasks/")
        self.assertEqual(get_response.data[0]["bucket_category"], str(category.id))

    def test_updates_a_task_from_one_category_to_another(self):
        owner, client = auth_client("bucket-update@example.com")
        to_go = Category.objects.create(user=owner, name="To Go")
        to_eat = Category.objects.create(user=owner, name="To Eat")
        payload = make_task_payload(scope_kind="bucket", scope_value="", bucket_category=str(to_go.id))
        create_response = client.post("/api/tasks/", payload, format="json")
        task_id = create_response.data["id"]

        payload["bucket_category"] = str(to_eat.id)
        update_response = client.put(f"/api/tasks/{task_id}/", payload, format="json")
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.data["bucket_category"], str(to_eat.id))

    def test_rejects_a_bucket_category_belonging_to_another_user(self):
        owner, client = auth_client("bucket-owner@example.com")
        other, _ = auth_client("bucket-other@example.com")
        others_category = Category.objects.create(user=other, name="Not Yours")
        payload = make_task_payload(
            scope_kind="bucket", scope_value="", bucket_category=str(others_category.id),
        )
        response = client.post("/api/tasks/", payload, format="json")
        self.assertEqual(response.status_code, 400)


class CategoryModelTests(TestCase):
    def test_two_users_can_each_have_a_category_with_the_same_name(self):
        owner, _ = auth_client("cat-owner@example.com")
        other, _ = auth_client("cat-other@example.com")
        Category.objects.create(user=owner, name="To Eat")
        Category.objects.create(user=other, name="To Eat")  # no IntegrityError

        self.assertEqual(Category.objects.filter(name="To Eat").count(), 2)

    def test_exact_duplicate_name_for_the_same_user_is_rejected_at_the_db_level(self):
        from django.db import IntegrityError

        owner, _ = auth_client("cat-dupe@example.com")
        Category.objects.create(user=owner, name="To Eat")
        with self.assertRaises(IntegrityError):
            Category.objects.create(user=owner, name="To Eat")
```

Add `Category` to the existing `from .models import Task` import at the top of the file (change to `from .models import Category, Task`).

Also update `make_task_payload` (same file) to include the new field with a harmless default so every *other* existing (non-bucket) test — which doesn't care about `bucket_category` — keeps passing unchanged:

```python
def make_task_payload(**overrides):
    payload = {
        "id": str(uuid.uuid4()),
        "title": "write plan",
        "memo": None,
        "done": False,
        "scope_kind": "day",
        "scope_value": "2026-07-27",
        "bucket_category": None,
        "rolled_from_kind": None,
        "rolled_from_value": None,
        "created_at": "2026-07-27T00:00:00.000Z",
        "completed_at": None,
        "time": None,
        "due_date": None,
        "subtasks": [],
        "repeat_weekdays": None,
        "repeat_source": None,
        "excluded_dates": None,
        "priority": None,
        "duration_minutes": None,
        "background": None,
    }
    payload.update(overrides)
    return payload
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks.tests.BucketScopeTests apps.tasks.tests.CategoryModelTests -v 2`
Expected: FAIL / ERROR — `Category` doesn't exist yet (`ImportError` on the `from .models import Category, Task` line), and the API doesn't know about `bucket_category`.

- [ ] **Step 3: Add the model**

In `backend/apps/tasks/models.py`, add `import uuid` at the top (alongside the existing `from django.conf import settings` / `from django.db import models`), then add the `Category` model above `Task` (order matters for the FK reference below), and add the `bucket_category` field + relax `scope_value` on `Task`:

```python
import uuid

from django.conf import settings
from django.db import models


SCOPE_KIND_CHOICES = [
    ("day", "day"),
    ("week", "week"),
    ("month", "month"),
    ("year", "year"),
    ("bucket", "bucket"),
]


class Category(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="categories"
    )
    name = models.CharField(max_length=60)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(fields=["user", "name"], name="unique_category_name_per_user"),
        ]

    def __str__(self):
        return self.name


class Task(models.Model):
    id = models.UUIDField(primary_key=True, editable=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="tasks"
    )
    title = models.CharField(max_length=500)
    memo = models.TextField(blank=True, null=True)
    done = models.BooleanField(default=False)
    scope_kind = models.CharField(max_length=10, choices=SCOPE_KIND_CHOICES)
    scope_value = models.CharField(max_length=60, blank=True)
    bucket_category = models.ForeignKey(
        Category, null=True, blank=True, on_delete=models.SET_NULL, related_name="tasks"
    )
    rolled_from_kind = models.CharField(
        max_length=10, blank=True, null=True, choices=SCOPE_KIND_CHOICES
    )
    rolled_from_value = models.CharField(max_length=20, blank=True, null=True)
    created_at = models.CharField(max_length=32)
    completed_at = models.CharField(max_length=32, blank=True, null=True)
    time = models.CharField(max_length=5, blank=True, null=True)
    due_date = models.CharField(max_length=10, blank=True, null=True)
    subtasks = models.JSONField(default=list, blank=True)
    repeat_weekdays = models.JSONField(blank=True, null=True)
    repeat_source = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="occurrences",
    )
    excluded_dates = models.JSONField(blank=True, null=True)
    priority = models.BooleanField(blank=True, null=True)
    duration_minutes = models.PositiveIntegerField(blank=True, null=True)
    background = models.BooleanField(blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]
        # No explicit index on `user` — a ForeignKey already implies
        # db_index=True, so an additional models.Index(fields=["user"])
        # here would be redundant. Harmless on SQLite (silently allowed),
        # but Oracle rejects creating a second index on an identical
        # column list with ORA-01408.

    def __str__(self):
        return self.title
```

- [ ] **Step 4: Generate and inspect the migration**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py makemigrations tasks --name category_and_bucket_category_fk`

Confirm the generated file (rename if Django's auto-name differs from `0004_category_and_bucket_category_fk.py`) contains, in this order: `CreateModel` for `Category` (with its `UniqueConstraint`), `AddField` for `Task.bucket_category`, `AlterField` for `Task.scope_value` (adding `blank=True`). If `makemigrations` produces a different operation order or splits across two files, consolidate by hand into one `0004_category_and_bucket_category_fk.py` — `Category` must be created before `Task.bucket_category` can reference it, which `makemigrations` handles automatically as long as `Category` is defined above `Task` in the models file (done in Step 3).

- [ ] **Step 5: Wire `bucket_category` into the serializer**

In `backend/apps/tasks/serializers.py`, update the import and add the field:

```python
from rest_framework import serializers

from .models import SCOPE_KIND_CHOICES, Category, Task


class SubtaskSerializer(serializers.Serializer):
    id = serializers.CharField()
    title = serializers.CharField()
    done = serializers.BooleanField()


class TaskSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField()
    memo = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    done = serializers.BooleanField(required=False, default=False)
    bucket_category = serializers.PrimaryKeyRelatedField(
        queryset=Category.objects.none(), allow_null=True, required=False, default=None,
    )
    rolled_from_kind = serializers.ChoiceField(
        choices=SCOPE_KIND_CHOICES, required=False, allow_null=True, allow_blank=True, default=None,
    )
    rolled_from_value = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, default=None, max_length=20,
    )
    completed_at = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, default=None, max_length=32,
    )
    time = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, default=None, max_length=5,
    )
    due_date = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, default=None, max_length=10,
    )
    subtasks = SubtaskSerializer(many=True, required=False, default=list)
    repeat_weekdays = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=6),
        required=False, allow_null=True, default=None,
    )
    repeat_source = serializers.PrimaryKeyRelatedField(
        queryset=Task.objects.none(), allow_null=True, required=False, default=None,
    )
    excluded_dates = serializers.ListField(
        child=serializers.CharField(), required=False, allow_null=True, default=None,
    )
    priority = serializers.BooleanField(required=False, allow_null=True, default=None)
    duration_minutes = serializers.IntegerField(
        required=False, allow_null=True, default=None, min_value=0,
    )
    background = serializers.BooleanField(required=False, allow_null=True, default=None)

    class Meta:
        model = Task
        fields = (
            "id",
            "title",
            "memo",
            "done",
            "scope_kind",
            "scope_value",
            "bucket_category",
            "rolled_from_kind",
            "rolled_from_value",
            "created_at",
            "completed_at",
            "time",
            "due_date",
            "subtasks",
            "repeat_weekdays",
            "repeat_source",
            "excluded_dates",
            "priority",
            "duration_minutes",
            "background",
        )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request is not None and request.user.is_authenticated:
            self.fields["repeat_source"].queryset = Task.objects.filter(user=request.user)
            self.fields["bucket_category"].queryset = Category.objects.filter(user=request.user)

    def validate_id(self, value):
        # Only enforced on create. On update, `id` is immutable (see
        # `update()` below) and gets discarded regardless of what's sent, so
        # checking it against existing rows here would reject legitimate PUTs
        # whenever the body happens to carry someone else's id — exactly the
        # attack `update()` already neutralizes by ignoring it outright.
        if self.instance is None and Task.objects.filter(id=value).exists():
            raise serializers.ValidationError("A task with this id already exists.")
        return value

    def update(self, instance, validated_data):
        # `id` is identity, not a mutable field — the URL's pk is authoritative
        # on PUT. Without this, DRF's default ModelSerializer.update() would
        # setattr(instance, "id", <body's id>) and instance.save() would then
        # UPDATE ... WHERE id = <that other id>, silently overwriting
        # whatever row already has that id (see task-1 security review).
        validated_data.pop("id", None)
        return super().update(instance, validated_data)
```

The `bucket_category` field's `queryset` gets scoped to the request's own user in `__init__`, exactly mirroring the existing `repeat_source` pattern two lines above it — this is what makes `test_rejects_a_bucket_category_belonging_to_another_user` (Step 1) fail with a 400 rather than silently succeeding.

- [ ] **Step 6: Apply the migration and run the tests**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py migrate`
Then: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks -v 2`
Expected: PASS — all tests, including the new/updated `BucketScopeTests` and `CategoryModelTests`, plus every pre-existing test in the file (unaffected by `bucket_category` defaulting to `None`).

- [ ] **Step 7: Commit**

```bash
git add backend/apps/tasks/models.py backend/apps/tasks/serializers.py backend/apps/tasks/migrations/0004_category_and_bucket_category_fk.py backend/apps/tasks/tests.py
git commit -m "feat: add a Category model and Task.bucket_category FK"
```

---

### Task 2: Backend — data migration backfilling existing bucket categories

**Files:**
- Create: `backend/apps/tasks/migrations/0005_backfill_bucket_categories.py`
- Modify: `backend/apps/tasks/tests.py`

**Interfaces:**
- Consumes: `Category`/`Task.bucket_category` from Task 1.
- Produces: every pre-existing bucket-scoped `Task` row (from before this plan) gets a real `Category` row and a populated `bucket_category` FK, derived from its old `scope_value` string. `scope_value` itself is left untouched on these rows (not cleared) — simply unused by the application going forward for bucket-scoped tasks.

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/tasks/tests.py`:

```python
import uuid as uuid_module

from django.contrib.auth import get_user_model as get_user_model_for_migration
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class BackfillBucketCategoriesMigrationTests(TransactionTestCase):
    def test_backfills_distinct_case_insensitive_categories_and_repoints_tasks(self):
        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0004_category_and_bucket_category_fk")])

        old_state = executor.loader.project_state(
            [("tasks", "0004_category_and_bucket_category_fk")]
        )
        OldUser = old_state.apps.get_model("auth", "User")
        OldTask = old_state.apps.get_model("tasks", "Task")

        user = OldUser.objects.create(username="migrate@example.com", email="migrate@example.com")
        other_user = OldUser.objects.create(username="migrate2@example.com", email="migrate2@example.com")

        # Same user, same category, two different castings — should dedupe
        # into ONE Category, keeping the earlier task's casing.
        OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="sushi", scope_kind="bucket",
            scope_value="To Eat", created_at="2026-07-01T00:00:00.000Z",
        )
        OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="ramen", scope_kind="bucket",
            scope_value="to eat", created_at="2026-07-02T00:00:00.000Z",
        )
        # A day-scoped task should be completely untouched by the migration.
        OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="unrelated", scope_kind="day",
            scope_value="2026-07-03", created_at="2026-07-03T00:00:00.000Z",
        )
        # A different user's bucket category with the SAME name as the first
        # user's — must become its own separate Category (per-user uniqueness).
        OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=other_user.id, title="also sushi", scope_kind="bucket",
            scope_value="To Eat", created_at="2026-07-01T00:00:00.000Z",
        )

        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0005_backfill_bucket_categories")])

        new_state = executor.loader.project_state(
            [("tasks", "0005_backfill_bucket_categories")]
        )
        NewCategory = new_state.apps.get_model("tasks", "Category")
        NewTask = new_state.apps.get_model("tasks", "Task")

        user_categories = NewCategory.objects.filter(user_id=user.id)
        self.assertEqual(user_categories.count(), 1)
        self.assertEqual(user_categories.first().name, "To Eat")  # earliest task's casing

        other_user_categories = NewCategory.objects.filter(user_id=other_user.id)
        self.assertEqual(other_user_categories.count(), 1)
        self.assertEqual(other_user_categories.first().id, other_user_categories.first().id)
        self.assertNotEqual(other_user_categories.first().id, user_categories.first().id)

        bucket_tasks = NewTask.objects.filter(user_id=user.id, scope_kind="bucket")
        self.assertEqual(bucket_tasks.count(), 2)
        for t in bucket_tasks:
            self.assertEqual(t.bucket_category_id, user_categories.first().id)

        untouched = NewTask.objects.get(user_id=user.id, scope_kind="day")
        self.assertIsNone(untouched.bucket_category_id)

        # Roll every app migration back to its latest state so later tests in
        # the suite (which use the real `apps.tasks.models.Task`/`Category`,
        # not this historical snapshot) run against the real schema.
        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", None)])
        call_command_migrate = __import__("django.core.management", fromlist=["call_command"]).call_command
        call_command_migrate("migrate")
```

`TransactionTestCase` (not `TestCase`) is required here because `MigrationExecutor.migrate()` runs real DDL (`CreateModel`/`AlterField`), which `TestCase`'s wrap-every-test-in-a-transaction-and-roll-back behavior is incompatible with.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks.tests.BackfillBucketCategoriesMigrationTests -v 2`
Expected: FAIL — migration `0005_backfill_bucket_categories` doesn't exist yet.

- [ ] **Step 3: Write the data migration**

Create `backend/apps/tasks/migrations/0005_backfill_bucket_categories.py`:

```python
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
```

- [ ] **Step 4: Apply the migration and run the tests**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py migrate`
Then: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks -v 2`
Expected: PASS — the new migration test, plus every other test in the app (the migration is a no-op against the fresh, empty-of-bucket-tasks test database each of those tests spins up).

- [ ] **Step 5: Commit**

```bash
git add backend/apps/tasks/migrations/0005_backfill_bucket_categories.py backend/apps/tasks/tests.py
git commit -m "feat: backfill existing bucket-scoped tasks into real Category rows"
```

---

### Task 3: Backend — Category API (list, create-or-reuse, rename)

**Files:**
- Modify: `backend/apps/tasks/serializers.py`
- Modify: `backend/apps/tasks/views.py`
- Modify: `backend/config/urls.py`
- Modify: `backend/apps/tasks/tests.py`

**Interfaces:**
- Produces: `GET /api/categories/` (the authenticated user's categories, ordered by `created_at`), `POST /api/categories/` (body: `{"name": str}`; returns 201 + the new category, or 200 + an existing category on a case-insensitive name match), `PATCH /api/categories/<uuid:pk>/` (body: `{"name": str}`; renames, rejecting a case-insensitive collision with the user's *other* categories with 400).

- [ ] **Step 1: Write the failing tests**

Append to `backend/apps/tasks/tests.py`:

```python
class CategoryApiTests(TestCase):
    def test_list_only_returns_the_authenticated_users_own_categories_ordered_by_created_at(self):
        owner, owner_client = auth_client("cat-list-owner@example.com")
        other, _ = auth_client("cat-list-other@example.com")
        first = Category.objects.create(user=owner, name="To Go")
        Category.objects.create(user=other, name="Not Mine")
        second = Category.objects.create(user=owner, name="To Eat")

        response = owner_client.get("/api/categories/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual([c["id"] for c in response.data], [str(first.id), str(second.id)])

    def test_create_makes_a_new_category(self):
        owner, client = auth_client("cat-create@example.com")

        response = client.post("/api/categories/", {"name": "  To Eat  "}, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["name"], "To Eat")
        self.assertEqual(Category.objects.filter(user=owner).count(), 1)

    def test_create_with_a_case_insensitive_duplicate_name_reuses_the_existing_category(self):
        owner, client = auth_client("cat-create-dupe@example.com")
        existing = Category.objects.create(user=owner, name="To Eat")

        response = client.post("/api/categories/", {"name": "to eat"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["id"], str(existing.id))
        self.assertEqual(Category.objects.filter(user=owner).count(), 1)

    def test_create_rejects_a_blank_name(self):
        owner, client = auth_client("cat-create-blank@example.com")

        response = client.post("/api/categories/", {"name": "   "}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Category.objects.filter(user=owner).count(), 0)

    def test_a_different_users_category_with_the_same_name_is_not_reused(self):
        owner, owner_client = auth_client("cat-create-scope@example.com")
        other, _ = auth_client("cat-create-scope-other@example.com")
        Category.objects.create(user=other, name="To Eat")

        response = owner_client.post("/api/categories/", {"name": "To Eat"}, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Category.objects.filter(user=owner).count(), 1)

    def test_rename_updates_the_name(self):
        owner, client = auth_client("cat-rename@example.com")
        category = Category.objects.create(user=owner, name="To Go")

        response = client.patch(f"/api/categories/{category.id}/", {"name": "To Visit"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["name"], "To Visit")
        category.refresh_from_db()
        self.assertEqual(category.name, "To Visit")

    def test_rename_rejects_a_case_insensitive_collision_with_another_category(self):
        owner, client = auth_client("cat-rename-collision@example.com")
        Category.objects.create(user=owner, name="To Eat")
        to_go = Category.objects.create(user=owner, name="To Go")

        response = client.patch(f"/api/categories/{to_go.id}/", {"name": "to eat"}, format="json")

        self.assertEqual(response.status_code, 400)
        to_go.refresh_from_db()
        self.assertEqual(to_go.name, "To Go")

    def test_rename_rejects_a_blank_name(self):
        owner, client = auth_client("cat-rename-blank@example.com")
        category = Category.objects.create(user=owner, name="To Go")

        response = client.patch(f"/api/categories/{category.id}/", {"name": "   "}, format="json")

        self.assertEqual(response.status_code, 400)
        category.refresh_from_db()
        self.assertEqual(category.name, "To Go")

    def test_cannot_rename_another_users_category(self):
        owner, _ = auth_client("cat-rename-owner@example.com")
        _, other_client = auth_client("cat-rename-attacker@example.com")
        category = Category.objects.create(user=owner, name="To Go")

        response = other_client.patch(f"/api/categories/{category.id}/", {"name": "Hijacked"}, format="json")

        self.assertEqual(response.status_code, 404)
        category.refresh_from_db()
        self.assertEqual(category.name, "To Go")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks.tests.CategoryApiTests -v 2`
Expected: FAIL — no `/api/categories/` route exists yet (404s across the board).

- [ ] **Step 3: Add the serializer**

In `backend/apps/tasks/serializers.py`, add below `SubtaskSerializer` (before `TaskSerializer`):

```python
class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ("id", "name", "created_at")
        read_only_fields = ("id", "created_at")
```

- [ ] **Step 4: Add the views**

In `backend/apps/tasks/views.py`:

```python
from rest_framework import generics, permissions, serializers as drf_serializers
from rest_framework.response import Response

from .models import Category, Task
from .serializers import CategorySerializer, TaskSerializer


class TaskListCreateView(generics.ListCreateAPIView):
    serializer_class = TaskSerializer
    permission_classes = (permissions.IsAuthenticated,)

    def get_queryset(self):
        return Task.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class TaskDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = TaskSerializer
    permission_classes = (permissions.IsAuthenticated,)

    def get_queryset(self):
        return Task.objects.filter(user=self.request.user)


class CategoryListCreateView(generics.ListCreateAPIView):
    serializer_class = CategorySerializer
    permission_classes = (permissions.IsAuthenticated,)

    def get_queryset(self):
        return Category.objects.filter(user=self.request.user).order_by("created_at")

    def create(self, request, *args, **kwargs):
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response({"name": ["This field may not be blank."]}, status=400)
        existing = Category.objects.filter(user=request.user, name__iexact=name).first()
        if existing is not None:
            return Response(self.get_serializer(existing).data, status=200)
        serializer = self.get_serializer(data={"name": name})
        serializer.is_valid(raise_exception=True)
        serializer.save(user=request.user)
        return Response(serializer.data, status=201)


class CategoryDetailView(generics.UpdateAPIView):
    serializer_class = CategorySerializer
    permission_classes = (permissions.IsAuthenticated,)
    http_method_names = ["patch", "options"]

    def get_queryset(self):
        return Category.objects.filter(user=self.request.user)

    def perform_update(self, serializer):
        name = (self.request.data.get("name") or "").strip()
        if not name:
            raise drf_serializers.ValidationError({"name": ["This field may not be blank."]})
        conflict = (
            Category.objects.filter(user=self.request.user, name__iexact=name)
            .exclude(pk=self.get_object().pk)
            .exists()
        )
        if conflict:
            raise drf_serializers.ValidationError({"name": ["A category with this name already exists."]})
        serializer.save(name=name)
```

`get_queryset` scoping `Category.objects.filter(user=self.request.user)` is what makes `test_cannot_rename_another_users_category` 404 rather than 403 — DRF's generic views 404 when the object exists but falls outside `get_queryset()`, matching every other cross-user-access test already in this file for `Task`.

- [ ] **Step 5: Wire the URLs**

In `backend/config/urls.py`, update the import and add the two new routes:

```python
from apps.tasks.views import CategoryDetailView, CategoryListCreateView, TaskDetailView, TaskListCreateView
```

(exact insertion point depends on the file's current import list — add the two `Category*` names to whatever existing `from apps.tasks.views import ...` line is there)

```python
    path("api/categories/", CategoryListCreateView.as_view(), name="category-list-create"),
    path("api/categories/<uuid:pk>/", CategoryDetailView.as_view(), name="category-detail"),
```

(add alongside the existing `path("api/tasks/", ...)` / `path("api/tasks/<uuid:pk>/", ...)` lines)

- [ ] **Step 6: Run the tests**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks -v 2`
Expected: PASS — all `CategoryApiTests`, plus every other test in the app.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/tasks/serializers.py backend/apps/tasks/views.py backend/config/urls.py backend/apps/tasks/tests.py
git commit -m "feat: add the Category list/create/rename API"
```

---

### Task 4: Frontend — `Category` type, `Scope`'s bucket variant → `categoryId`, mapping, grouping

**Files:**
- Modify: `frontend/src/features/tasks/types.ts`
- Modify: `frontend/src/features/tasks/types.test.ts`
- Modify: `frontend/src/features/tasks/api/mapping.ts`
- Modify: `frontend/src/features/tasks/api/mapping.test.ts`
- Modify: `frontend/src/features/tasks/data/repository.ts`
- Modify: `frontend/src/features/tasks/lib/categories.ts`
- Modify: `frontend/src/features/tasks/lib/categories.test.ts`

**Interfaces:**
- Produces: `Category { id: string; name: string; createdAt: string }` (new, in `types.ts`). `Scope`'s bucket variant becomes `{ kind: "bucket"; categoryId: string }`. `groupBucketTasks(tasks: Task[], categories: Category[]): BucketCategoryGroup[]` where `BucketCategoryGroup = { categoryId: string; categoryName: string; active: Task[]; completed: Task[] }` — one entry per **category**, not per category-in-use, so an empty category still produces a group with empty arrays.
- Consumes (later tasks): Task 6 (store) constructs `Scope`'s bucket variant and calls `groupBucketTasks`; Task 7/8 (components) read `BucketCategoryGroup.categoryName`/`categoryId`.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/types.test.ts`, find the existing `scopeKey` test for the bucket case and replace it (the exact existing test text will reference `scope.category`; update it to `categoryId`):

```typescript
it("returns a category-key for a bucket scope", () => {
  expect(scopeKey({ kind: "bucket", categoryId: "cat-1" })).toBe("bucket:cat-1");
});
```

In `frontend/src/features/tasks/api/mapping.test.ts`, replace the existing "round-trips a bucket-scoped task" test with:

```typescript
it("round-trips a bucket-scoped task", () => {
  const task: Task = {
    id: "b1",
    title: "visit kyoto",
    done: false,
    scope: { kind: "bucket", categoryId: "cat-1" },
    createdAt: "2026-07-30T00:00:00.000Z",
  };
  const payload = toApiPayload(task);
  expect(payload.scope_kind).toBe("bucket");
  expect(payload.scope_value).toBe("");
  expect(payload.bucket_category).toBe("cat-1");
  expect(fromApiPayload(payload)).toEqual(task);
});
```

Replace `frontend/src/features/tasks/lib/categories.ts`'s entire test file, `frontend/src/features/tasks/lib/categories.test.ts`, with:

```typescript
import { describe, expect, it } from "vitest";

import { makeTask } from "../test-utils";
import { groupBucketTasks } from "./categories";
import type { Category } from "../types";

function makeCategory(overrides: Partial<Category> = {}): Category {
  return { id: "cat-default", name: "Default", createdAt: "2026-07-01T00:00:00.000Z", ...overrides };
}

describe("groupBucketTasks", () => {
  it("orders groups by the category's own createdAt, not task data", () => {
    const toGo = makeCategory({ id: "c-go", name: "To Go", createdAt: "2026-07-02T00:00:00.000Z" });
    const toEat = makeCategory({ id: "c-eat", name: "To Eat", createdAt: "2026-07-01T00:00:00.000Z" });
    // toGo's only task is created *earlier* than toEat's, but toEat's
    // category itself was created earlier — category createdAt must win.
    const tasks = [
      makeTask({ id: "1", scope: { kind: "bucket", categoryId: "c-go" }, createdAt: "2026-06-01T00:00:00.000Z" }),
      makeTask({ id: "2", scope: { kind: "bucket", categoryId: "c-eat" }, createdAt: "2026-06-15T00:00:00.000Z" }),
    ];

    const groups = groupBucketTasks(tasks, [toGo, toEat]);

    expect(groups.map((g) => g.categoryId)).toEqual(["c-eat", "c-go"]);
  });

  it("includes a category with zero tasks as an empty group", () => {
    const empty = makeCategory({ id: "c-empty", name: "Someday" });
    const groups = groupBucketTasks([], [empty]);
    expect(groups).toEqual([{ categoryId: "c-empty", categoryName: "Someday", active: [], completed: [] }]);
  });

  it("within a category: active first, completed below, both in creation order", () => {
    const category = makeCategory({ id: "c-1" });
    const tasks = [
      makeTask({ id: "done-1", done: true, scope: { kind: "bucket", categoryId: "c-1" }, createdAt: "2026-07-01T00:00:00.000Z" }),
      makeTask({ id: "active-1", scope: { kind: "bucket", categoryId: "c-1" }, createdAt: "2026-07-02T00:00:00.000Z" }),
      makeTask({ id: "active-2", scope: { kind: "bucket", categoryId: "c-1" }, createdAt: "2026-07-03T00:00:00.000Z" }),
    ];

    const [group] = groupBucketTasks(tasks, [category]);

    expect(group.active.map((t) => t.id)).toEqual(["active-1", "active-2"]);
    expect(group.completed.map((t) => t.id)).toEqual(["done-1"]);
  });

  it("ignores a bucket-scoped task whose categoryId matches no known category", () => {
    const category = makeCategory({ id: "c-1" });
    const orphan = makeTask({ scope: { kind: "bucket", categoryId: "deleted-category" } });

    const groups = groupBucketTasks([orphan], [category]);

    expect(groups).toEqual([{ categoryId: "c-1", categoryName: "Default", active: [], completed: [] }]);
  });

  it("does not include day/week/month/year-scoped tasks in any group", () => {
    const category = makeCategory({ id: "c-1" });
    const dayTask = makeTask({ scope: { kind: "day", date: "2026-07-16" } });

    const [group] = groupBucketTasks([dayTask], [category]);

    expect(group.active).toEqual([]);
    expect(group.completed).toEqual([]);
  });
});
```

This file drops the old `resolveCategoryCasing`/`normalizeCategoryInput`/`bucketCategoriesInUse` tests entirely — those functions are being removed in Step 3 below (dead code once category identity is by id).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/types.test.ts src/features/tasks/api/mapping.test.ts src/features/tasks/lib/categories.test.ts`
Expected: FAIL — `scope.categoryId` doesn't exist on the `Scope` type yet (TS errors surfacing as test failures), `bucket_category` isn't a field on `ApiTask`, `groupBucketTasks`'s signature doesn't accept a second argument yet.

- [ ] **Step 3: Update `types.ts`**

In `frontend/src/features/tasks/types.ts`, change the `Scope` union's bucket case and `scopeKey`'s bucket case, and add the `Category` interface:

```typescript
export type Scope =
  | { kind: "day"; date: string }
  | { kind: "week"; weekStart: string }
  | { kind: "month"; month: string }
  | { kind: "year"; year: string }
  | { kind: "bucket"; categoryId: string };

export interface Category {
  id: string;
  name: string;
  createdAt: string;
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

// ... Task interface unchanged ...

export function scopeKey(scope: Scope): string {
  switch (scope.kind) {
    case "day":
      return `day:${scope.date}`;
    case "week":
      return `week:${scope.weekStart}`;
    case "month":
      return `month:${scope.month}`;
    case "year":
      return `year:${scope.year}`;
    case "bucket":
      return `bucket:${scope.categoryId}`;
  }
}
```

- [ ] **Step 4: Update `mapping.ts`**

In `frontend/src/features/tasks/api/mapping.ts`:

```typescript
import type { Scope, Subtask, Task } from "../types";

type ScopeKind = Scope["kind"];

export interface ApiTask {
  id: string;
  title: string;
  memo: string | null;
  done: boolean;
  scope_kind: ScopeKind;
  scope_value: string;
  bucket_category: string | null;
  rolled_from_kind: ScopeKind | null;
  rolled_from_value: string | null;
  created_at: string;
  completed_at: string | null;
  time: string | null;
  due_date: string | null;
  subtasks: Subtask[];
  repeat_weekdays: number[] | null;
  repeat_source: string | null;
  excluded_dates: string[] | null;
  priority: boolean | null;
  duration_minutes: number | null;
  background: boolean | null;
}

function scopeValueOf(scope: Scope): string {
  switch (scope.kind) {
    case "day":
      return scope.date;
    case "week":
      return scope.weekStart;
    case "month":
      return scope.month;
    case "year":
      return scope.year;
    case "bucket":
      // Unused on the wire for bucket scope — bucket_category is the real
      // reference. Kept as "" (not e.g. the category id) so scope_value
      // never silently duplicates identity that could drift from the FK.
      return "";
  }
}

function scopeFromParts(kind: ScopeKind, value: string, bucketCategoryId: string | null): Scope {
  switch (kind) {
    case "day":
      return { kind: "day", date: value };
    case "week":
      return { kind: "week", weekStart: value };
    case "month":
      return { kind: "month", month: value };
    case "year":
      return { kind: "year", year: value };
    case "bucket":
      // rolled_from_kind/rolled_from_value can theoretically be "bucket" per
      // the type system, but nothing in this app ever rolls a bucket-scoped
      // task over (rollover.ts only handles day/week/month) — unreachable
      // in practice, so there's no rolled_from_bucket_category wire field to
      // read here; bucketCategoryId is always null on that call path.
      return { kind: "bucket", categoryId: bucketCategoryId ?? "" };
  }
}

export function toApiPayload(task: Task): ApiTask {
  return {
    id: task.id,
    title: task.title,
    memo: task.memo ?? null,
    done: task.done,
    scope_kind: task.scope.kind,
    scope_value: scopeValueOf(task.scope),
    bucket_category: task.scope.kind === "bucket" ? task.scope.categoryId : null,
    rolled_from_kind: task.rolledFrom?.kind ?? null,
    rolled_from_value: task.rolledFrom ? scopeValueOf(task.rolledFrom) : null,
    created_at: task.createdAt,
    completed_at: task.completedAt ?? null,
    time: task.time ?? null,
    due_date: task.dueDate ?? null,
    subtasks: task.subtasks ?? [],
    repeat_weekdays: task.repeatWeekdays ?? null,
    repeat_source: task.repeatSourceId ?? null,
    excluded_dates: task.excludedDates ?? null,
    priority: task.priority ?? null,
    duration_minutes: task.durationMinutes ?? null,
    background: task.background ?? null,
  };
}

export function fromApiPayload(payload: ApiTask): Task {
  return {
    id: payload.id,
    title: payload.title,
    memo: payload.memo ?? undefined,
    done: payload.done,
    scope: scopeFromParts(payload.scope_kind, payload.scope_value, payload.bucket_category),
    rolledFrom:
      payload.rolled_from_kind && payload.rolled_from_value
        ? scopeFromParts(payload.rolled_from_kind, payload.rolled_from_value, null)
        : undefined,
    createdAt: payload.created_at,
    completedAt: payload.completed_at ?? undefined,
    time: payload.time ?? undefined,
    subtasks: payload.subtasks.length > 0 ? payload.subtasks : undefined,
    repeatWeekdays: payload.repeat_weekdays ?? undefined,
    repeatSourceId: payload.repeat_source ?? undefined,
    excludedDates: payload.excluded_dates ?? undefined,
    priority: payload.priority ?? undefined,
    durationMinutes: payload.duration_minutes ?? undefined,
    background: payload.background ?? undefined,
    dueDate: payload.due_date ?? undefined,
  };
}
```

- [ ] **Step 5: Update `repository.ts`'s `SCOPE_FIELDS`**

In `frontend/src/features/tasks/data/repository.ts`, change the bucket entry:

```typescript
const SCOPE_FIELDS = {
  day: "date",
  week: "weekStart",
  month: "month",
  year: "year",
  bucket: "categoryId",
} as const;
```

(this is the only change needed in this file — `isScope`/`isTask`/everything else is generic over `SCOPE_FIELDS`)

- [ ] **Step 6: Rewrite `lib/categories.ts`**

Replace the entire contents of `frontend/src/features/tasks/lib/categories.ts`:

```typescript
import type { Category, Task } from "../types";

export interface BucketCategoryGroup {
  categoryId: string;
  categoryName: string;
  active: Task[];
  completed: Task[];
}

// One entry per saved Category (not per category-in-use) — an empty
// category still produces a group with empty arrays. Ordered by the
// category's own createdAt, ascending; never derived from task data.
// Within each group: active tasks first, completed below, both in stable
// creation order.
export function groupBucketTasks(tasks: Task[], categories: Category[]): BucketCategoryGroup[] {
  const bucketTasks = tasks.filter(
    (t): t is Task & { scope: { kind: "bucket"; categoryId: string } } => t.scope.kind === "bucket",
  );

  const byCategory = new Map<string, Task[]>();
  for (const t of bucketTasks) {
    const list = byCategory.get(t.scope.categoryId) ?? [];
    list.push(t);
    byCategory.set(t.scope.categoryId, list);
  }

  const sortedCategories = [...categories].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return sortedCategories.map((category) => {
    const items = byCategory.get(category.id) ?? [];
    const sorted = [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      categoryId: category.id,
      categoryName: category.name,
      active: sorted.filter((t) => !t.done),
      completed: sorted.filter((t) => t.done),
    };
  });
}
```

`resolveCategoryCasing`, `normalizeCategoryInput`, and `bucketCategoriesInUse` are deliberately dropped — category-name normalization is now the backend's job (Task 3's create-or-reuse endpoint), and nothing on the frontend derives a category list from task data anymore.

- [ ] **Step 7: Run the tests and typecheck**

Run: `cd frontend && npx vitest run src/features/tasks/types.test.ts src/features/tasks/api/mapping.test.ts src/features/tasks/lib/categories.test.ts`
Expected: PASS.

Run: `cd frontend && npx tsc --noEmit`
Expected: **many** errors — every file still using the old `bucketCategories: string[]` / `task.scope.category` / `resolveCategoryCasing` shape (store.tsx, task-category-editor.tsx, task-detail-fields.tsx, task-detail-drawer.tsx, task-item.tsx, bucket-category-section.tsx, bucket-list-view.tsx) is now broken. This is expected and gets fixed task-by-task through Task 8 — do not attempt to fix those files in this task. Confirm the *only* errors are in those known downstream files, not somewhere unrelated.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/tasks/types.ts frontend/src/features/tasks/types.test.ts frontend/src/features/tasks/api/mapping.ts frontend/src/features/tasks/api/mapping.test.ts frontend/src/features/tasks/data/repository.ts frontend/src/features/tasks/lib/categories.ts frontend/src/features/tasks/lib/categories.test.ts
git commit -m "feat: move bucket Scope identity to a categoryId, add the Category type"
```

---

### Task 5: Frontend — Next.js BFF proxy routes for categories

**Files:**
- Create: `frontend/src/features/tasks/api/categories.ts`
- Create: `frontend/src/app/api/categories/route.ts`
- Create: `frontend/src/app/api/categories/[id]/route.ts`
- Modify: `frontend/src/features/tasks/api/mapping.ts`
- Modify: `frontend/src/features/tasks/api/mapping.test.ts`

**Interfaces:**
- Produces: `requestListCategories(): Promise<Category[]>`, `requestCreateCategory(name: string): Promise<Category>`, `requestRenameCategory(id: string, name: string): Promise<Category>` (server-side, in `features/tasks/api/categories.ts`) plus the two browser-facing proxy routes `/api/categories` (GET/POST) and `/api/categories/[id]` (PATCH), exactly mirroring the existing `/api/tasks` pair.
- Consumes: Task 4's `Category` type; Task 3's backend endpoints.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/features/tasks/api/mapping.test.ts` (this file already tests `toApiPayload`/`fromApiPayload`; add category mapping tests alongside):

```typescript
import { categoryFromApiPayload } from "./mapping";
// (add to the existing import line from "./mapping" rather than a new import statement)

describe("categoryFromApiPayload", () => {
  it("maps an ApiCategory to a Category", () => {
    const payload = { id: "cat-1", name: "To Eat", created_at: "2026-07-30T00:00:00.000Z" };
    expect(categoryFromApiPayload(payload)).toEqual({
      id: "cat-1",
      name: "To Eat",
      createdAt: "2026-07-30T00:00:00.000Z",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/features/tasks/api/mapping.test.ts`
Expected: FAIL — `categoryFromApiPayload` doesn't exist yet.

- [ ] **Step 3: Add category mapping to `mapping.ts`**

Append to `frontend/src/features/tasks/api/mapping.ts` (after the existing `fromApiPayload` function):

```typescript
import type { Category } from "../types";

export interface ApiCategory {
  id: string;
  name: string;
  created_at: string;
}

export function categoryFromApiPayload(payload: ApiCategory): Category {
  return { id: payload.id, name: payload.name, createdAt: payload.created_at };
}
```

(merge the `import type { Category } from "../types";` into the file's existing `import type { Scope, Subtask, Task } from "../types";` line rather than adding a second import statement)

- [ ] **Step 4: Add the server-side request functions**

Create `frontend/src/features/tasks/api/categories.ts`, closely mirroring `frontend/src/features/tasks/api/tasks.ts`'s existing `apiRequest`-based calls (`requestUpdateTask`/`requestDeleteTask`) — category create/rename don't need the special duplicate-id handling `requestCreateTask` has, since categories don't use client-generated ids:

```typescript
import { apiRequest } from "@/lib/api/server";

import { categoryFromApiPayload, type ApiCategory } from "./mapping";
import type { Category } from "../types";

export async function requestListCategories(): Promise<Category[]> {
  const payloads = await apiRequest<ApiCategory[]>("/api/categories/", { authenticated: true });
  return payloads.map(categoryFromApiPayload);
}

export async function requestCreateCategory(name: string): Promise<Category> {
  const payload = await apiRequest<ApiCategory>("/api/categories/", {
    method: "POST",
    body: JSON.stringify({ name }),
    authenticated: true,
  });
  return categoryFromApiPayload(payload);
}

export async function requestRenameCategory(id: string, name: string): Promise<Category> {
  const payload = await apiRequest<ApiCategory>(`/api/categories/${id}/`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
    authenticated: true,
  });
  return categoryFromApiPayload(payload);
}
```

- [ ] **Step 5: Add the browser-facing proxy routes**

Create `frontend/src/app/api/categories/route.ts`, mirroring `frontend/src/app/api/tasks/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server";

import { requestCreateCategory, requestListCategories } from "@/features/tasks/api/categories";
import { ApiUnauthorizedError } from "@/lib/api/server";
import { unauthorizedResponse } from "@/lib/auth/cookies";

export async function GET() {
  try {
    const categories = await requestListCategories();
    return NextResponse.json(categories);
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load categories." },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json();
    const category = await requestCreateCategory(name);
    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create category." },
      { status: 400 },
    );
  }
}
```

Create `frontend/src/app/api/categories/[id]/route.ts`, mirroring `frontend/src/app/api/tasks/[id]/route.ts`'s `PUT` handler shape but for `PATCH`:

```typescript
import { NextResponse, type NextRequest } from "next/server";

import { requestRenameCategory } from "@/features/tasks/api/categories";
import { ApiUnauthorizedError } from "@/lib/api/server";
import { unauthorizedResponse } from "@/lib/auth/cookies";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { name } = await request.json();
    const category = await requestRenameCategory(id, name);
    return NextResponse.json(category);
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to rename category." },
      { status: 400 },
    );
  }
}
```

Note that both `POST`'s 201 response and the create-or-reuse 200 response coming back from the Django API (Task 3) pass through unchanged here — `requestCreateCategory`'s `apiRequest` call doesn't care whether the underlying status was 200 or 201 as long as it's `.ok`, and this route always responds 201 regardless. That's an acceptable simplification: the frontend only cares about *which* category it got back, not whether the server created or reused one.

- [ ] **Step 6: Run the tests and typecheck**

Run: `cd frontend && npx vitest run src/features/tasks/api/mapping.test.ts`
Expected: PASS.

Run: `cd frontend && npx tsc --noEmit`
Expected: same set of pre-existing downstream errors as Task 4 left behind (store.tsx, task-category-editor.tsx, etc.) — no *new* errors from the files this task touches.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/tasks/api/categories.ts frontend/src/app/api/categories/route.ts frontend/src/app/api/categories/[id]/route.ts frontend/src/features/tasks/api/mapping.ts frontend/src/features/tasks/api/mapping.test.ts
git commit -m "feat: add the Next.js BFF proxy routes for categories"
```

---

### Task 6: Frontend — `CategoryRepository`, store integration, `addBucketItem`/`setCategory` by id

**Files:**
- Create: `frontend/src/features/tasks/data/category-repository.ts`
- Modify: `frontend/src/features/tasks/store.tsx`
- Modify: `frontend/src/features/tasks/store.test.tsx`
- Modify: `frontend/src/features/tasks/test-utils.tsx`

**Interfaces:**
- Produces: `CategoryRepository { list(): Promise<Category[]>; create(name: string): Promise<Category>; rename(id: string, name: string): Promise<Category>; }`, `createApiCategoryRepository(): CategoryRepository`. `TasksState` gains `categories: Category[]`. `TasksContextValue` gains `createCategory(name: string): Promise<Category | undefined>` and `renameCategory(id: string, name: string): Promise<boolean>`. `addBucketItem(title: string, categoryId: string): Task | undefined` and `setCategory(id: string, categoryId: string): void` (signatures change from a free-text `category` name to `categoryId`).
- Consumes: Task 5's `requestListCategories`/`requestCreateCategory`/`requestRenameCategory`; Task 4's `Category` type.

- [ ] **Step 1: Write the failing tests**

Add `fakeCategoryRepository` to `frontend/src/features/tasks/test-utils.tsx` (alongside the existing `fakeRepository`):

```typescript
import type { CategoryRepository } from "./data/category-repository";
import type { Category, Task } from "./types";
// (merge into the existing `import type { Task } from "./types";` line)

export function fakeCategoryRepository(
  initial: Category[] = [],
): CategoryRepository & { categories: Category[] } {
  const state = { categories: [...initial] };
  return {
    get categories() {
      return state.categories;
    },
    async list() {
      return [...state.categories];
    },
    async create(name) {
      const existing = state.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (existing) return existing;
      const category: Category = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() };
      state.categories = [...state.categories, category];
      return category;
    },
    async rename(id, name) {
      const category = state.categories.find((c) => c.id === id);
      if (!category) throw new Error("Category not found.");
      const renamed = { ...category, name };
      state.categories = state.categories.map((c) => (c.id === id ? renamed : c));
      return renamed;
    },
  };
}
```

In `frontend/src/features/tasks/store.test.tsx`, find the existing `describe("bucket list actions", ...)` block (added when `addBucketItem`/`setCategory` were first built) and replace its two tests, and update `setup()` to accept a category repo:

```typescript
import { fakeCategoryRepository, fakeRepository, makeTask } from "./test-utils";
// (merge into whatever existing import line pulls these in)

function setup(repo = fakeRepository(), categoryRepo = fakeCategoryRepository()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TasksProvider repository={repo} categoryRepository={categoryRepo}>{children}</TasksProvider>
  );
  return { repo, categoryRepo, ...renderHook(() => useTasks(), { wrapper }) };
}
```

(the exact `setup` signature/body will need matching against the file's real current form — the key change is threading a second `categoryRepo` param through to a new `categoryRepository` prop on `TasksProvider`, alongside the existing `repository` prop)

```typescript
describe("bucket list actions", () => {
  it("addBucketItem creates a task in the given category and rejects a blank title", async () => {
    const category = { id: "c-1", name: "To Eat", createdAt: "2026-07-01T00:00:00.000Z" };
    const { repo, result } = setup(fakeRepository(), fakeCategoryRepository([category]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.addBucketItem("  try the new ramen place  ", "c-1");
    });
    await waitFor(() => expect(result.current.tasks).toHaveLength(1));
    const created = result.current.tasks[0];
    expect(created.title).toBe("try the new ramen place");
    expect(created.scope).toEqual({ kind: "bucket", categoryId: "c-1" });
    await waitFor(() => expect(repo.tasks).toHaveLength(1));

    act(() => result.current.addBucketItem("   ", "c-1"));
    expect(result.current.tasks).toHaveLength(1); // blank title rejected

    act(() => result.current.addBucketItem("valid title", ""));
    expect(result.current.tasks).toHaveLength(1); // blank categoryId rejected
  });

  it("setCategory moves a task to a different category by id, persisting the change", async () => {
    const toGo = { id: "c-go", name: "To Go", createdAt: "2026-07-01T00:00:00.000Z" };
    const toEat = { id: "c-eat", name: "To Eat", createdAt: "2026-07-02T00:00:00.000Z" };
    const task = makeTask({ id: "a", scope: { kind: "bucket", categoryId: "c-go" } });
    const { repo, result } = setup(fakeRepository([task]), fakeCategoryRepository([toGo, toEat]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.setCategory("a", "c-eat"));
    expect(result.current.tasks[0].scope).toEqual({ kind: "bucket", categoryId: "c-eat" });
    await waitFor(() => expect(repo.tasks[0].scope).toEqual({ kind: "bucket", categoryId: "c-eat" }));
  });
});

describe("category actions", () => {
  it("createCategory creates and returns a new category, rejecting a blank name", async () => {
    const { categoryRepo, result } = setup();
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let created: Category | undefined;
    await act(async () => {
      created = await result.current.createCategory("  To Eat  ");
    });
    expect(created?.name).toBe("To Eat");
    await waitFor(() => expect(result.current.categories).toHaveLength(1));
    expect(categoryRepo.categories).toHaveLength(1);

    let rejected: Category | undefined;
    await act(async () => {
      rejected = await result.current.createCategory("   ");
    });
    expect(rejected).toBeUndefined();
    expect(result.current.categories).toHaveLength(1);
  });

  it("renameCategory updates the category's name and reports success", async () => {
    const category = { id: "c-1", name: "To Go", createdAt: "2026-07-01T00:00:00.000Z" };
    const { categoryRepo, result } = setup(fakeRepository(), fakeCategoryRepository([category]));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await waitFor(() => expect(result.current.categories).toHaveLength(1));

    let ok = false;
    await act(async () => {
      ok = await result.current.renameCategory("c-1", "To Visit");
    });
    expect(ok).toBe(true);
    expect(result.current.categories[0].name).toBe("To Visit");
    expect(categoryRepo.categories[0].name).toBe("To Visit");
  });

  it("categories load alongside tasks on initial load", async () => {
    const category = { id: "c-1", name: "To Eat", createdAt: "2026-07-01T00:00:00.000Z" };
    const { result } = setup(fakeRepository(), fakeCategoryRepository([category]));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.categories).toEqual([category]);
  });
});
```

This intentionally drops any pre-existing `addBucketItem`/`setCategory` tests that asserted on free-text category-casing normalization (e.g. `"to eat"` reusing `"To Eat"`'s casing directly in the store) — that behavior now lives entirely on the backend (Task 3's create-or-reuse endpoint) and in `fakeCategoryRepository.create` for tests, not in `addBucketItem`/`setCategory` themselves.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/store.test.tsx`
Expected: FAIL — `categoryRepository` isn't a valid `TasksProvider` prop yet, `createCategory`/`renameCategory` don't exist, `result.current.categories` is undefined.

- [ ] **Step 3: Add the `CategoryRepository`**

Create `frontend/src/features/tasks/data/category-repository.ts`:

```typescript
import { requestCreateCategory, requestListCategories, requestRenameCategory } from "../api/categories";
import type { Category } from "../types";

export interface CategoryRepository {
  list(): Promise<Category[]>;
  create(name: string): Promise<Category>;
  rename(id: string, name: string): Promise<Category>;
}

// Unlike TaskRepository, there's no offline/localStorage variant — category
// creation is always awaited (never optimistic; see store.tsx's
// createCategory), so there's nothing for a legacy-migration path to upload.
export function createApiCategoryRepository(): CategoryRepository {
  return {
    list: requestListCategories,
    create: requestCreateCategory,
    rename: requestRenameCategory,
  };
}
```

- [ ] **Step 4: Update `store.tsx`**

Full replacement of `frontend/src/features/tasks/store.tsx`:

```typescript
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import { createApiCategoryRepository } from "./data/category-repository";
import type { CategoryRepository } from "./data/category-repository";
import { createApiTaskRepository } from "./data/api-task-repository";
import type { TaskRepository } from "./data/repository";
import { todayKey } from "./lib/dates";
import { isValidTime } from "./lib/times";
import { rolloverTasks } from "./lib/rollover";
import { materializeRoutines } from "./lib/routines";
import type { Category, Scope, Task } from "./types";

const SYNC_ERROR_MESSAGE = "Something didn't save. Reconnecting to check what's saved…";

export interface TasksState {
  loaded: boolean;
  tasks: Task[];
  categories: Category[];
  syncError: string | null;
}

export type TasksAction =
  | { type: "loaded"; tasks: Task[]; categories?: Category[] }
  | { type: "added"; task: Task }
  | { type: "updated"; task: Task }
  | { type: "removed"; id: string }
  | { type: "categoryAdded"; category: Category }
  | { type: "categoryUpdated"; category: Category }
  | { type: "syncErrorOccurred" }
  | { type: "syncErrorDismissed" };

export function tasksReducer(
  state: TasksState,
  action: TasksAction,
): TasksState {
  switch (action.type) {
    case "loaded":
      return {
        ...state,
        loaded: true,
        tasks: action.tasks,
        categories: action.categories ?? state.categories,
      };
    case "added":
      return { ...state, tasks: [...state.tasks, action.task] };
    case "updated":
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.task.id ? action.task : t,
        ),
      };
    case "removed":
      return { ...state, tasks: state.tasks.filter((t) => t.id !== action.id) };
    case "categoryAdded":
      return { ...state, categories: [...state.categories, action.category] };
    case "categoryUpdated":
      return {
        ...state,
        categories: state.categories.map((c) =>
          c.id === action.category.id ? action.category : c,
        ),
      };
    case "syncErrorOccurred":
      return { ...state, syncError: SYNC_ERROR_MESSAGE };
    case "syncErrorDismissed":
      return { ...state, syncError: null };
  }
}

interface TasksContextValue extends TasksState {
  addTask: (title: string, scope: Scope) => Task | undefined;
  toggleTask: (id: string) => void;
  setMemo: (id: string, memo: string) => void;
  setTime: (id: string, time: string | undefined) => void;
  setRepeatWeekdays: (id: string, weekdays: number[] | undefined) => void;
  detachFromRoutine: (id: string, weekdays?: number[]) => void;
  rescheduleTaskToDay: (id: string, date: string) => void;
  setPriority: (id: string, priority: boolean) => void;
  setDuration: (id: string, durationMinutes: number | undefined) => void;
  setBackground: (id: string, background: boolean) => void;
  setDueDate: (id: string, dueDate: string | undefined) => void;
  removeTask: (id: string) => void;
  addSubtask: (id: string, title: string) => void;
  toggleSubtask: (id: string, subtaskId: string) => void;
  removeSubtask: (id: string, subtaskId: string) => void;
  editSubtaskTitle: (id: string, subtaskId: string, title: string) => void;
  addBucketItem: (title: string, categoryId: string) => Task | undefined;
  setCategory: (id: string, categoryId: string) => void;
  createCategory: (name: string) => Promise<Category | undefined>;
  renameCategory: (id: string, name: string) => Promise<boolean>;
  dismissSyncError: () => void;
}

const TasksContext = createContext<TasksContextValue | null>(null);

export function TasksProvider({
  repository,
  categoryRepository,
  children,
}: {
  repository?: TaskRepository;
  categoryRepository?: CategoryRepository;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(tasksReducer, {
    loaded: false,
    tasks: [],
    categories: [],
    syncError: null,
  });
  const repo = useMemo(
    () => repository ?? createApiTaskRepository(),
    [repository],
  );
  const categoryRepo = useMemo(
    () => categoryRepository ?? createApiCategoryRepository(),
    [categoryRepository],
  );

  const tasksRef = useRef(state.tasks);
  tasksRef.current = state.tasks;
  const appliedDayRef = useRef<string | null>(null);
  const resyncingRef = useRef(false);

  function handleSyncFailure() {
    dispatch({ type: "syncErrorOccurred" });
    // A single outage typically fails several writes at once (every rolled
    // and spawned task on load); without this guard each one would kick off
    // its own full resync — and for the API repository every resync re-runs
    // the entire legacy-migration upload loop.
    if (resyncingRef.current) return;
    resyncingRef.current = true;
    void repo
      .list()
      .then((tasks) => dispatch({ type: "loaded", tasks }))
      .catch(() => {
        // Already surfaced via syncErrorOccurred above; a second
        // consecutive failure just leaves the banner up rather than
        // compounding into an unhandled rejection.
      })
      .finally(() => {
        resyncingRef.current = false;
      });
  }

  useEffect(() => {
    let cancelled = false;
    void Promise.all([repo.list(), categoryRepo.list()])
      .then(([tasks, categories]) => {
        if (cancelled) return;
        const today = todayKey();
        const rolled = rolloverTasks(tasks, today);
        const spawned = materializeRoutines(rolled, today);
        const finalTasks = [...rolled, ...spawned];
        dispatch({ type: "loaded", tasks: finalTasks, categories });
        appliedDayRef.current = today;
        rolled.forEach((task, i) => {
          if (task !== tasks[i]) repo.update(task).catch(handleSyncFailure);
        });
        spawned.forEach((task) => repo.create(task).catch(handleSyncFailure));
      })
      .catch(() => {
        if (cancelled) return;
        dispatch({ type: "syncErrorOccurred" });
        dispatch({ type: "loaded", tasks: [], categories: [] });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, categoryRepo]);

  useEffect(() => {
    function rolloverIfDateChanged() {
      if (appliedDayRef.current === null) return;
      const today = todayKey();
      if (today === appliedDayRef.current) return;
      const tasks = tasksRef.current;
      const rolled = rolloverTasks(tasks, today);
      const spawned = materializeRoutines(rolled, today);
      const finalTasks = [...rolled, ...spawned];
      dispatch({ type: "loaded", tasks: finalTasks });
      appliedDayRef.current = today;
      rolled.forEach((task, i) => {
        if (task !== tasks[i]) repo.update(task).catch(handleSyncFailure);
      });
      spawned.forEach((task) => repo.create(task).catch(handleSyncFailure));
    }

    window.addEventListener("focus", rolloverIfDateChanged);
    document.addEventListener("visibilitychange", rolloverIfDateChanged);
    return () => {
      window.removeEventListener("focus", rolloverIfDateChanged);
      document.removeEventListener("visibilitychange", rolloverIfDateChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  const value = useMemo<TasksContextValue>(
    () => ({
      ...state,
      addTask(title, scope) {
        const trimmed = title.trim();
        if (!trimmed) return undefined;
        const task: Task = {
          id: crypto.randomUUID(),
          title: trimmed,
          done: false,
          scope,
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: "added", task });
        repo.create(task).catch(handleSyncFailure);
        return task;
      },
      addBucketItem(title, categoryId) {
        const trimmed = title.trim();
        if (!trimmed || !categoryId) return undefined;
        const task: Task = {
          id: crypto.randomUUID(),
          title: trimmed,
          done: false,
          scope: { kind: "bucket", categoryId },
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: "added", task });
        repo.create(task).catch(handleSyncFailure);
        return task;
      },
      toggleTask(id) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const task: Task = {
          ...current,
          done: !current.done,
          completedAt: current.done ? undefined : new Date().toISOString(),
        };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      setMemo(id, memo) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, memo: memo.trim() || undefined };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      setTime(id, time) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        if (time !== undefined && !isValidTime(time)) return;
        const task: Task = { ...current, time };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      setRepeatWeekdays(id, weekdays) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const normalized = weekdays && weekdays.length > 0 ? weekdays : undefined;
        const task: Task = {
          ...current,
          repeatWeekdays: normalized,
          dueDate: normalized ? undefined : current.dueDate,
        };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      detachFromRoutine(id, weekdays) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const normalized = weekdays && weekdays.length > 0 ? weekdays : undefined;
        const task: Task = { ...current, repeatSourceId: undefined, repeatWeekdays: normalized };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);

        if (current.repeatSourceId !== undefined && current.scope.kind === "day") {
          const anchor = state.tasks.find((t) => t.id === current.repeatSourceId);
          if (anchor) {
            const excludedDates = [...(anchor.excludedDates ?? []), current.scope.date];
            const updatedAnchor: Task = { ...anchor, excludedDates };
            dispatch({ type: "updated", task: updatedAnchor });
            repo.update(updatedAnchor).catch(handleSyncFailure);
          }
        }
      },
      rescheduleTaskToDay(id, date) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;

        let originalDate: string;
        if (current.scope.kind === "day") {
          originalDate = current.scope.date;
        } else if (current.scope.kind === "week" && current.rolledFrom?.kind === "day") {
          originalDate = current.rolledFrom.date;
        } else {
          return;
        }
        if (originalDate === date) return;

        const task: Task = { ...current, scope: { kind: "day", date }, rolledFrom: undefined };
        if (current.repeatSourceId !== undefined) {
          task.repeatSourceId = undefined;
        }
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);

        if (current.repeatSourceId !== undefined) {
          const anchor = state.tasks.find((t) => t.id === current.repeatSourceId);
          if (anchor) {
            const excludedDates = [...(anchor.excludedDates ?? []), originalDate];
            const updatedAnchor: Task = { ...anchor, excludedDates };
            dispatch({ type: "updated", task: updatedAnchor });
            repo.update(updatedAnchor).catch(handleSyncFailure);
          }
        }
      },
      setPriority(id, priority) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, priority };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      setDuration(id, durationMinutes) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, durationMinutes };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      setBackground(id, background) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, background };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      setDueDate(id, dueDate) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, dueDate };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      setCategory(id, categoryId) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current || current.scope.kind !== "bucket" || !categoryId) return;
        const task: Task = { ...current, scope: { kind: "bucket", categoryId } };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      async createCategory(name) {
        const trimmed = name.trim();
        if (!trimmed) return undefined;
        try {
          const category = await categoryRepo.create(trimmed);
          // create-or-reuse: only dispatch if this category isn't already
          // in state (the server may have returned an existing match).
          if (!state.categories.some((c) => c.id === category.id)) {
            dispatch({ type: "categoryAdded", category });
          }
          return category;
        } catch {
          return undefined;
        }
      },
      async renameCategory(id, name) {
        const trimmed = name.trim();
        if (!trimmed) return false;
        try {
          const category = await categoryRepo.rename(id, trimmed);
          dispatch({ type: "categoryUpdated", category });
          return true;
        } catch {
          return false;
        }
      },
      addSubtask(id, title) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const trimmed = title.trim();
        if (!trimmed) return;
        const task: Task = {
          ...current,
          subtasks: [
            ...(current.subtasks ?? []),
            { id: crypto.randomUUID(), title: trimmed, done: false },
          ],
        };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      toggleSubtask(id, subtaskId) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current?.subtasks) return;
        const task: Task = {
          ...current,
          subtasks: current.subtasks.map((s) =>
            s.id === subtaskId ? { ...s, done: !s.done } : s,
          ),
        };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      removeSubtask(id, subtaskId) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current?.subtasks) return;
        const task: Task = {
          ...current,
          subtasks: current.subtasks.filter((s) => s.id !== subtaskId),
        };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      editSubtaskTitle(id, subtaskId, title) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current?.subtasks) return;
        const trimmed = title.trim();
        if (!trimmed) return;
        const task: Task = {
          ...current,
          subtasks: current.subtasks.map((s) =>
            s.id === subtaskId ? { ...s, title: trimmed } : s,
          ),
        };
        dispatch({ type: "updated", task });
        repo.update(task).catch(handleSyncFailure);
      },
      removeTask(id) {
        const current = state.tasks.find((t) => t.id === id);
        dispatch({ type: "removed", id });
        repo.remove(id).catch(handleSyncFailure);

        // Deleting a spawned occurrence must tell its anchor not to
        // re-spawn it — otherwise the next load's materializeRoutines()
        // sees no same-day occurrence and recreates it, "resurrecting" a
        // task the user just deleted. Same excludedDates handling as
        // detachFromRoutine/rescheduleTaskToDay above.
        if (current?.repeatSourceId !== undefined && current.scope.kind === "day") {
          const anchor = state.tasks.find((t) => t.id === current.repeatSourceId);
          if (anchor) {
            const excludedDates = [...(anchor.excludedDates ?? []), current.scope.date];
            const updatedAnchor: Task = { ...anchor, excludedDates };
            dispatch({ type: "updated", task: updatedAnchor });
            repo.update(updatedAnchor).catch(handleSyncFailure);
          }
        }
      },
      dismissSyncError() {
        dispatch({ type: "syncErrorDismissed" });
      },
    }),
    [state, repo, categoryRepo],
  );

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}

export function useTasks(): TasksContextValue {
  const context = useContext(TasksContext);
  if (!context) throw new Error("useTasks must be used within TasksProvider");
  return context;
}
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `cd frontend && npx vitest run src/features/tasks/store.test.tsx`
Expected: PASS — all store tests, including the new category ones.

Run: `cd frontend && npx tsc --noEmit`
Expected: the remaining downstream errors are now narrowed to just the UI component files (task-category-editor.tsx, task-detail-fields.tsx, task-detail-drawer.tsx, task-item.tsx, bucket-category-section.tsx, bucket-list-view.tsx) — store.tsx itself and everything it depends on should be clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/tasks/data/category-repository.ts frontend/src/features/tasks/store.tsx frontend/src/features/tasks/store.test.tsx frontend/src/features/tasks/test-utils.tsx
git commit -m "feat: add categories to the store, switch bucket actions to categoryId"
```

---

### Task 7: Frontend — `TaskCategoryEditor` becomes a select + inline create, drawer/fields prop threading

**Files:**
- Modify: `frontend/src/features/tasks/components/task-category-editor.tsx`
- Modify: `frontend/src/features/tasks/components/task-category-editor.test.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-fields.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-drawer.tsx`
- Modify: `frontend/src/features/tasks/components/task-item.tsx`

**Interfaces:**
- Consumes: Task 4's `Category` type; Task 6's `createCategory`/`setCategory`.
- Produces: `TaskCategoryEditor({ categoryId, categories, onCategoryChange, onCreateCategory })` — a `<select>` over `categories` with a trailing "+ New category…" option that reveals an inline name input; selecting or creating calls `onCategoryChange(categoryId)`.

- [ ] **Step 1: Write the failing tests**

Replace `frontend/src/features/tasks/components/task-category-editor.test.tsx` entirely:

```typescript
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskCategoryEditor } from "./task-category-editor";

const categories = [
  { id: "c-go", name: "To Go", createdAt: "2026-07-01T00:00:00.000Z" },
  { id: "c-eat", name: "To Eat", createdAt: "2026-07-02T00:00:00.000Z" },
];

describe("TaskCategoryEditor", () => {
  it("shows the current category selected among the given categories", () => {
    render(
      <TaskCategoryEditor
        categoryId="c-eat"
        categories={categories}
        onCategoryChange={vi.fn()}
        onCreateCategory={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Category")).toHaveValue("c-eat");
  });

  it("calls onCategoryChange when an existing category is picked", () => {
    const onCategoryChange = vi.fn();
    render(
      <TaskCategoryEditor
        categoryId="c-eat"
        categories={categories}
        onCategoryChange={onCategoryChange}
        onCreateCategory={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "c-go" } });
    expect(onCategoryChange).toHaveBeenCalledWith("c-go");
  });

  it("re-syncs the selected value when categoryId changes underneath it (no remount)", () => {
    const { rerender } = render(
      <TaskCategoryEditor
        categoryId="c-go"
        categories={categories}
        onCategoryChange={vi.fn()}
        onCreateCategory={vi.fn()}
      />,
    );
    rerender(
      <TaskCategoryEditor
        categoryId="c-eat"
        categories={categories}
        onCategoryChange={vi.fn()}
        onCreateCategory={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Category")).toHaveValue("c-eat");
  });

  it("picking + New category… reveals a name input; submitting creates and selects it", async () => {
    const created = { id: "c-new", name: "Someday", createdAt: "2026-07-03T00:00:00.000Z" };
    const onCreateCategory = vi.fn().mockResolvedValue(created);
    const onCategoryChange = vi.fn();
    render(
      <TaskCategoryEditor
        categoryId="c-eat"
        categories={categories}
        onCategoryChange={onCategoryChange}
        onCreateCategory={onCreateCategory}
      />,
    );

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "__new__" } });
    const nameInput = screen.getByLabelText("New category name");
    fireEvent.change(nameInput, { target: { value: "Someday" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });

    await screen.findByLabelText("Category"); // back to select view
    expect(onCreateCategory).toHaveBeenCalledWith("Someday");
    expect(onCategoryChange).toHaveBeenCalledWith("c-new");
  });

  it("Escape cancels category creation and returns to the select without creating anything", () => {
    const onCreateCategory = vi.fn();
    render(
      <TaskCategoryEditor
        categoryId="c-eat"
        categories={categories}
        onCategoryChange={vi.fn()}
        onCreateCategory={onCreateCategory}
      />,
    );
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "__new__" } });
    fireEvent.keyDown(screen.getByLabelText("New category name"), { key: "Escape" });
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
    expect(onCreateCategory).not.toHaveBeenCalled();
  });

  it("starts directly in create mode when there are no categories yet", () => {
    render(
      <TaskCategoryEditor
        categoryId=""
        categories={[]}
        onCategoryChange={vi.fn()}
        onCreateCategory={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("New category name")).toBeInTheDocument();
    expect(screen.queryByLabelText("Category")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-category-editor.test.tsx`
Expected: FAIL — the component still takes the old `category`/free-text props.

- [ ] **Step 3: Rewrite `task-category-editor.tsx`**

```typescript
"use client";

import { useEffect, useId, useState } from "react";

import type { Category } from "../types";

const NEW_CATEGORY_VALUE = "__new__";

export function TaskCategoryEditor({
  categoryId,
  categories,
  onCategoryChange,
  onCreateCategory,
}: {
  categoryId: string;
  categories: Category[];
  onCategoryChange: (categoryId: string) => void;
  onCreateCategory: (name: string) => Promise<Category | undefined>;
}) {
  const selectId = useId();
  const [creating, setCreating] = useState(categories.length === 0);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The drawer swaps between bucket tasks in place (no remount), so this
  // must re-sync whenever the underlying task changes — otherwise the
  // select keeps showing the previous task's category.
  useEffect(() => {
    setCreating(categories.length === 0);
    setNewName("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  if (creating) {
    // Deliberately a <div>, not a <form>: this component gets used inside
    // bucket-list-view.tsx's own composer <form> (Task 8), and HTML forbids
    // nesting <form> inside <form> — a nested form's submit would either be
    // ignored or misbehave depending on the browser. Enter-to-submit and
    // Escape-to-cancel are handled directly on the input's key events
    // instead, so behavior matches a real form without being one.
    const submit = async () => {
      const trimmed = newName.trim();
      if (!trimmed) return;
      const created = await onCreateCategory(trimmed);
      if (!created) {
        setError("Couldn't create that category.");
        return;
      }
      onCategoryChange(created.id);
      setCreating(false);
      setNewName("");
      setError(null);
    };

    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-subtle">Category</span>
        <div className="flex gap-1.5">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
                return;
              }
              if (e.key !== "Escape") return;
              e.preventDefault();
              if (categories.length === 0) return; // nothing to fall back to
              setCreating(false);
              setNewName("");
              setError(null);
            }}
            placeholder="New category name"
            aria-label="New category name"
            maxLength={60}
            className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <button
            type="button"
            onClick={() => void submit()}
            className="shrink-0 rounded-md border border-input px-2.5 py-1.5 text-sm text-foreground/80 transition-colors duration-200 hover:bg-muted/40"
          >
            Add
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <label className="flex flex-col gap-1.5" htmlFor={selectId}>
      <span className="text-[11px] font-medium text-subtle">Category</span>
      <select
        id={selectId}
        aria-label="Category"
        value={categoryId}
        onChange={(e) => {
          if (e.target.value === NEW_CATEGORY_VALUE) {
            setCreating(true);
            return;
          }
          onCategoryChange(e.target.value);
        }}
        className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value={NEW_CATEGORY_VALUE}>+ New category…</option>
      </select>
    </label>
  );
}
```

Note: the `<label htmlFor={selectId}>` + `<select id={selectId} aria-label="Category">` combination means the select has both an associated `<label>` (via `htmlFor`) and an explicit `aria-label` — matching this codebase's existing pattern in the old version of this same file (it had both a visible label and `aria-label="Category"` on the input) rather than introducing a new convention.

- [ ] **Step 4: Update `task-detail-fields.tsx`**

In `frontend/src/features/tasks/components/task-detail-fields.tsx`, change the props and the bucket-category section:

```typescript
import type { Category, Task } from "../types";
// (merge into the existing `import type { Task } from "../types";` line)
```

```typescript
export function TaskDetailFields({
  task,
  onMemoChange,
  onTimeChange,
  onRepeatWeekdaysChange,
  onDetachFromRoutine,
  onPriorityChange,
  onDurationChange,
  onBackgroundChange,
  onDueDateChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
  onEditSubtaskTitle,
  categories = [],
  onCategoryChange,
  onCreateCategory,
  showTime = true,
  showDelete = true,
  variant = "default",
  upcomingRepeatDates,
}: {
  task: Task;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onRepeatWeekdaysChange: (weekdays: number[]) => void;
  onDetachFromRoutine: () => void;
  onPriorityChange: (priority: boolean) => void;
  onDurationChange: (durationMinutes?: number) => void;
  onBackgroundChange: (background: boolean) => void;
  onDueDateChange: (dueDate?: string) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
  onEditSubtaskTitle: (subtaskId: string, title: string) => void;
  categories?: Category[];
  onCategoryChange?: (categoryId: string) => void;
  onCreateCategory?: (name: string) => Promise<Category | undefined>;
  showTime?: boolean;
  showDelete?: boolean;
  variant?: "default" | "drawer";
  upcomingRepeatDates?: string[];
}) {
```

(the rest of the function body is unchanged except the bucket-category section, around the existing `{task.scope.kind === "bucket" && ...}` block):

```typescript
      {task.scope.kind === "bucket" && onCategoryChange && onCreateCategory && (
        <section className={cn(drawer && "space-y-2.5")}>
          <TaskCategoryEditor
            categoryId={task.scope.categoryId}
            categories={categories}
            onCategoryChange={onCategoryChange}
            onCreateCategory={onCreateCategory}
          />
        </section>
      )}
```

(the `onCategoryChange && onCreateCategory` guard replaces the old `onCategoryChange={(category) => onCategoryChange?.(category)}` optional-call pattern — since `TaskCategoryEditor` now requires both callbacks non-optionally, the section simply doesn't render if either is missing, which only happens for a non-bucket-scoped task's fields anyway since the outer `task.scope.kind === "bucket"` check already gates it)

- [ ] **Step 5: Update `task-detail-drawer.tsx`**

In `frontend/src/features/tasks/components/task-detail-drawer.tsx`:

```typescript
import { completedAtLabel } from "../lib/dates";
import type { Category, Scope, Task } from "../types";
// (merge Category into the existing types import line)
```

```typescript
interface Draft {
  done: boolean;
  memo: string;
  time?: string;
  durationMinutes?: number;
  priority: boolean;
  background: boolean;
  repeatWeekdays: number[];
  detached: boolean;
  dueDate?: string;
  categoryId?: string;
}

function draftFromTask(task: Task): Draft {
  return {
    done: task.done,
    memo: task.memo ?? "",
    time: task.time,
    durationMinutes: task.durationMinutes,
    priority: !!task.priority,
    background: !!task.background,
    repeatWeekdays: task.repeatWeekdays ?? [],
    detached: false,
    dueDate: task.dueDate,
    categoryId: task.scope.kind === "bucket" ? task.scope.categoryId : undefined,
  };
}

export function TaskDetailDrawer({
  task,
  onToggle,
  onClose,
  onMemoChange,
  onTimeChange,
  onRepeatWeekdaysChange,
  onDetachFromRoutine,
  onPriorityChange,
  onDurationChange,
  onBackgroundChange,
  onDueDateChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
  onEditSubtaskTitle,
  categories = [],
  onCategoryChange,
  onCreateCategory,
  upcomingRepeatDates,
}: {
  task: Task;
  onToggle: () => void;
  onClose: () => void;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onRepeatWeekdaysChange: (weekdays: number[]) => void;
  onDetachFromRoutine: (weekdays?: number[]) => void;
  onPriorityChange: (priority: boolean) => void;
  onDurationChange: (durationMinutes?: number) => void;
  onBackgroundChange: (background: boolean) => void;
  onDueDateChange: (dueDate?: string) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
  onEditSubtaskTitle: (subtaskId: string, title: string) => void;
  categories?: Category[];
  onCategoryChange?: (categoryId: string) => void;
  onCreateCategory?: (name: string) => Promise<Category | undefined>;
  upcomingRepeatDates?: string[];
}) {
```

(the component body is unchanged down through `handleDone`, except its bucket-category-commit check and the `draftScope`/`draftTask` construction just below it):

```typescript
  const handleDone = () => {
    if (draft.done !== task.done) onToggle();
    if (draft.memo !== (task.memo ?? "")) onMemoChange(draft.memo);
    if (draft.time !== task.time) onTimeChange(draft.time);
    if (draft.durationMinutes !== task.durationMinutes) onDurationChange(draft.durationMinutes);
    if (draft.priority !== !!task.priority) onPriorityChange(draft.priority);
    if (draft.background !== !!task.background) onBackgroundChange(draft.background);
    if (draft.dueDate !== task.dueDate) onDueDateChange(draft.dueDate);
    if (
      task.scope.kind === "bucket" &&
      draft.categoryId !== undefined &&
      draft.categoryId !== task.scope.categoryId
    ) {
      onCategoryChange?.(draft.categoryId);
    }
    const original = task.repeatWeekdays ?? [];
    const weekdaysChanged =
      draft.repeatWeekdays.length !== original.length ||
      draft.repeatWeekdays.some((d, i) => d !== original[i]);
    if (draft.detached) {
      onDetachFromRoutine(weekdaysChanged ? draft.repeatWeekdays : undefined);
    } else if (weekdaysChanged) {
      onRepeatWeekdaysChange(draft.repeatWeekdays);
    }
    onClose();
  };

  const { detached, categoryId: draftCategoryId, ...draftFields } = draft;
  const draftScope: Scope =
    task.scope.kind === "bucket" && draftCategoryId !== undefined
      ? { kind: "bucket", categoryId: draftCategoryId }
      : task.scope;
  const draftTask: Task = {
    ...task,
    ...draftFields,
    scope: draftScope,
    repeatSourceId: detached ? undefined : task.repeatSourceId,
  };
```

And the `<TaskDetailFields>` call inside the JSX:

```typescript
        <TaskDetailFields
          task={draftTask}
          onMemoChange={(memo) => setDraft((d) => ({ ...d, memo }))}
          onTimeChange={(time) => setDraft((d) => ({ ...d, time }))}
          onRepeatWeekdaysChange={(repeatWeekdays) => setDraft((d) => ({ ...d, repeatWeekdays }))}
          onDetachFromRoutine={() => setDraft((d) => ({ ...d, detached: true }))}
          onPriorityChange={(priority) => setDraft((d) => ({ ...d, priority }))}
          onDurationChange={(durationMinutes) => setDraft((d) => ({ ...d, durationMinutes }))}
          onBackgroundChange={(background) => setDraft((d) => ({ ...d, background }))}
          onDueDateChange={(dueDate) => setDraft((d) => ({ ...d, dueDate }))}
          upcomingRepeatDates={upcomingRepeatDates}
          onDelete={onDelete}
          onAddSubtask={onAddSubtask}
          onToggleSubtask={onToggleSubtask}
          onRemoveSubtask={onRemoveSubtask}
          onEditSubtaskTitle={onEditSubtaskTitle}
          categories={categories}
          onCategoryChange={(categoryId) => setDraft((d) => ({ ...d, categoryId }))}
          onCreateCategory={onCreateCategory}
          showTime={task.scope.kind !== "bucket"}
          showDelete={false}
          variant="drawer"
        />
```

- [ ] **Step 6: Update `task-item.tsx`**

In `frontend/src/features/tasks/components/task-item.tsx`, `taskItemHandlers` needs to also thread `onCreateCategory` (the drawer's callers spread `taskItemHandlers(...)` onto `TaskDetailDrawer`, so this is where it needs to originate). Find the `TaskItemActions` interface and `taskItemHandlers` function (the same ones already carrying `setCategory`) and add:

```typescript
interface TaskItemActions {
  // ... existing entries unchanged ...
  editSubtaskTitle: (id: string, subtaskId: string, title: string) => void;
  setCategory: (id: string, categoryId: string) => void;
  createCategory: (name: string) => Promise<import("../types").Category | undefined>;
}
```

(if the file already has a `Category` type import elsewhere, use that import instead of the inline `import("../types").Category` — check the file's existing import list first and prefer a normal named import: `import type { Category } from "../types";` merged into whatever type-only import already exists there)

```typescript
    onEditSubtaskTitle: (subtaskId: string, title: string) =>
      actions.editSubtaskTitle(id, subtaskId, title),
    onCategoryChange: (categoryId: string) => actions.setCategory(id, categoryId),
    onCreateCategory: (name: string) => actions.createCategory(name),
  };
}
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `cd frontend && npx vitest run src/features/tasks/components/task-category-editor.test.tsx src/features/tasks/components/task-detail-fields.test.tsx src/features/tasks/components/task-detail-drawer.test.tsx`
Expected: some pre-existing tests in `task-detail-fields.test.tsx`/`task-detail-drawer.test.tsx` reference the old `bucketCategories`/`onCategoryChange={(category) => ...}` free-text shape — update any such test to pass `categories={[{id: "...", name: "...", createdAt: "..."}]}` and `onCreateCategory={vi.fn()}` instead, following the same pattern as the rewritten `task-category-editor.test.tsx`. After updating, expect PASS across all three files.

Run: `cd frontend && npx tsc --noEmit`
Expected: remaining errors narrowed to `bucket-category-section.tsx`/`bucket-list-view.tsx` only (Task 8).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/tasks/components/task-category-editor.tsx frontend/src/features/tasks/components/task-category-editor.test.tsx frontend/src/features/tasks/components/task-detail-fields.tsx frontend/src/features/tasks/components/task-detail-fields.test.tsx frontend/src/features/tasks/components/task-detail-drawer.tsx frontend/src/features/tasks/components/task-detail-drawer.test.tsx frontend/src/features/tasks/components/task-item.tsx
git commit -m "feat: turn the category editor into a select with inline creation"
```

---

### Task 8: Frontend — `bucket-category-section.tsx` and `bucket-list-view.tsx` on real categories

**Files:**
- Modify: `frontend/src/features/tasks/components/bucket-category-section.tsx`
- Modify: `frontend/src/features/tasks/components/bucket-category-section.test.tsx`
- Modify: `frontend/src/features/tasks/components/views/bucket-list-view.tsx`
- Modify: `frontend/src/features/tasks/components/views/bucket-list-view.test.tsx`

**Interfaces:**
- Consumes: Task 4's `groupBucketTasks(tasks, categories)`; Task 6's `categories`/`createCategory` from the store; Task 7's `TaskCategoryEditor`/`categories` prop on `TaskDetailDrawer`.

- [ ] **Step 1: Write the failing tests**

Replace `frontend/src/features/tasks/components/bucket-category-section.test.tsx` entirely — every `category="X"` prop becomes `categoryId="c-x" categoryName="X"` (mechanical rename, no behavioral change to any existing test):

```typescript
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { makeTask } from "../test-utils";
import { BucketCategorySection } from "./bucket-category-section";

describe("BucketCategorySection", () => {
  const active = [makeTask({ id: "a1", title: "sushi", done: false })];
  const completed = [makeTask({ id: "c1", title: "ramen", done: true })];

  it("shows the category name and an item count", () => {
    render(
      <BucketCategorySection
        categoryId="c-eat"
        categoryName="To Eat"
        active={active}
        completed={completed}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    expect(screen.getByText("To Eat")).toBeTruthy();
    expect(screen.getByText("2 items")).toBeTruthy();
  });

  it("uses singular '1 item' for exactly one item", () => {
    render(
      <BucketCategorySection
        categoryId="c-go"
        categoryName="To Go"
        active={active}
        completed={[]}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    expect(screen.getByText("1 item")).toBeTruthy();
  });

  it("renders active items before completed items", () => {
    render(
      <BucketCategorySection
        categoryId="c-eat"
        categoryName="To Eat"
        active={active}
        completed={completed}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    const titles = screen.getAllByText(/sushi|ramen/).map((el) => el.textContent);
    expect(titles).toEqual(["sushi", "ramen"]);
  });

  it("shows a completed item muted with strikethrough, not hidden", () => {
    render(
      <BucketCategorySection
        categoryId="c-eat"
        categoryName="To Eat"
        active={[]}
        completed={completed}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    const title = screen.getByText("ramen");
    expect(title.className).toContain("line-through");
    expect(title.className).toContain("text-muted-foreground");
  });

  it("calls onToggle when a row's checkbox is clicked", () => {
    const onToggle = vi.fn();
    render(
      <BucketCategorySection
        categoryId="c-eat"
        categoryName="To Eat"
        active={active}
        completed={[]}
        onToggle={onToggle}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Toggle sushi"));
    expect(onToggle).toHaveBeenCalledWith("a1");
  });

  it("calls onSelect when a row's title is clicked", () => {
    const onSelect = vi.fn();
    render(
      <BucketCategorySection
        categoryId="c-eat"
        categoryName="To Eat"
        active={active}
        completed={[]}
        onToggle={() => {}}
        onSelect={onSelect}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("sushi"));
    expect(onSelect).toHaveBeenCalledWith("a1");
  });

  it("calls onDelete from the row's hover-revealed delete control", () => {
    const onDelete = vi.fn();
    render(
      <BucketCategorySection
        categoryId="c-eat"
        categoryName="To Eat"
        active={active}
        completed={[]}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={onDelete}
        onAddItem={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Delete sushi"));
    expect(onDelete).toHaveBeenCalledWith("a1");
  });

  it("shows a due-date badge when present, turning destructive when overdue and not done", () => {
    const overdue = [
      makeTask({ id: "o1", title: "renew passport", done: false, dueDate: "2020-01-01" }),
    ];
    render(
      <BucketCategorySection
        categoryId="c-do"
        categoryName="To Do"
        active={overdue}
        completed={[]}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    const badge = screen.getByText(/Due/);
    expect(badge.className).toContain("text-destructive");
  });

  it("shows a Priority badge when present", () => {
    const priority = [makeTask({ id: "p1", title: "climb Fuji", priority: true })];
    render(
      <BucketCategorySection
        categoryId="c-go"
        categoryName="To Go"
        active={priority}
        completed={[]}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={() => {}}
      />,
    );
    expect(screen.getByText("Priority")).toBeTruthy();
  });

  it("has a per-category add-item row that calls onAddItem with the typed title", () => {
    const onAddItem = vi.fn();
    render(
      <BucketCategorySection
        categoryId="c-eat"
        categoryName="To Eat"
        active={[]}
        completed={[]}
        onToggle={() => {}}
        onSelect={() => {}}
        onDelete={() => {}}
        onAddItem={onAddItem}
      />,
    );
    const input = screen.getByLabelText("Add item to To Eat");
    fireEvent.change(input, { target: { value: "ramen" } });
    fireEvent.submit(input.closest("form")!);
    expect(onAddItem).toHaveBeenCalledWith("ramen");
    expect((input as HTMLInputElement).value).toBe(""); // ready for the next entry
  });
});
```

Replace `frontend/src/features/tasks/components/views/bucket-list-view.test.tsx` entirely:

```typescript
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { fakeCategoryRepository, fakeRepository, makeTask } from "../../test-utils";
import { TasksProvider } from "../../store";
import type { Category } from "../../types";
import { BucketListView } from "./bucket-list-view";

function renderView(tasks = [] as ReturnType<typeof makeTask>[], categories = [] as Category[]) {
  return render(
    <TasksProvider repository={fakeRepository(tasks)} categoryRepository={fakeCategoryRepository(categories)}>
      <BucketListView anchor="2026-07-16" onAnchorChange={() => {}} />
    </TasksProvider>,
  );
}

const toEat: Category = { id: "c-eat", name: "To Eat", createdAt: "2026-07-01T00:00:00.000Z" };
const toGo: Category = { id: "c-go", name: "To Go", createdAt: "2026-07-02T00:00:00.000Z" };

describe("BucketListView", () => {
  it("shows the empty state when there are no bucket tasks", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText("Your bucket list is empty")).toBeTruthy());
    expect(screen.getByText("Add something you want to do, try, visit, or remember.")).toBeTruthy();
  });

  it("groups tasks by category and shows item counts", async () => {
    renderView(
      [
        makeTask({ id: "1", title: "sushi", scope: { kind: "bucket", categoryId: "c-eat" } }),
        makeTask({ id: "2", title: "Kyoto", scope: { kind: "bucket", categoryId: "c-go" } }),
      ],
      [toEat, toGo],
    );
    await waitFor(() => expect(screen.getByText("To Eat")).toBeTruthy());
    expect(screen.getByText("To Go")).toBeTruthy();
    expect(screen.getByText("sushi")).toBeTruthy();
    expect(screen.getByText("Kyoto")).toBeTruthy();
  });

  it("completes and un-completes an item from its row", async () => {
    renderView(
      [makeTask({ id: "1", title: "sushi", done: false, scope: { kind: "bucket", categoryId: "c-eat" } })],
      [toEat],
    );
    await waitFor(() => expect(screen.getByLabelText("Toggle sushi")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Toggle sushi"));
    await waitFor(() => expect(screen.getByText("sushi").className).toContain("line-through"));
    fireEvent.click(screen.getByLabelText("Toggle sushi"));
    await waitFor(() => expect(screen.getByText("sushi").className).not.toContain("line-through"));
  });

  it("deletes an item from its row", async () => {
    renderView([makeTask({ id: "1", title: "sushi", scope: { kind: "bucket", categoryId: "c-eat" } })], [toEat]);
    await waitFor(() => expect(screen.getByText("sushi")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Delete sushi"));
    await waitFor(() => expect(screen.queryByText("sushi")).toBeNull());
  });

  it("keeps an emptied category's section visible (categories persist independently of tasks)", async () => {
    renderView(
      [
        makeTask({ id: "1", title: "sushi", scope: { kind: "bucket", categoryId: "c-eat" } }),
        makeTask({ id: "2", title: "Kyoto", scope: { kind: "bucket", categoryId: "c-go" } }),
      ],
      [toEat, toGo],
    );
    await waitFor(() => expect(screen.getByText("To Eat")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Delete sushi"));
    await waitFor(() => expect(screen.queryByText("sushi")).toBeNull());
    expect(screen.getByText("To Eat")).toBeTruthy(); // section stays — category persists even with zero items
    expect(screen.getByText("0 items")).toBeTruthy();
    expect(screen.getByText("To Go")).toBeTruthy(); // untouched
  });

  it("an empty category (zero tasks from the start) still renders its own section with an add-item row", async () => {
    const someday: Category = { id: "c-someday", name: "Someday", createdAt: "2026-07-03T00:00:00.000Z" };
    renderView([], [someday]);
    await waitFor(() => expect(screen.getByText("Someday")).toBeTruthy());
    expect(screen.getByText("0 items")).toBeTruthy();
    expect(screen.getByLabelText("Add item to Someday")).toBeTruthy();
  });

  it("opens the Task Detail drawer when a row's title is clicked", async () => {
    renderView([makeTask({ id: "1", title: "sushi", scope: { kind: "bucket", categoryId: "c-eat" } })], [toEat]);
    await waitFor(() => expect(screen.getByText("sushi")).toBeTruthy());
    fireEvent.click(screen.getByText("sushi"));
    await waitFor(() => expect(screen.getByTestId("task-detail-drawer")).toBeTruthy());
    expect(screen.queryByLabelText("Task time")).toBeNull(); // scheduling fields hidden
  });

  it("adds several items with Enter inside one category without losing focus", async () => {
    renderView([makeTask({ id: "1", title: "sushi", scope: { kind: "bucket", categoryId: "c-eat" } })], [toEat]);
    await waitFor(() => expect(screen.getByLabelText("Add item to To Eat")).toBeTruthy());
    const input = screen.getByLabelText("Add item to To Eat") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "ramen" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(screen.getByText("ramen")).toBeTruthy());

    fireEvent.change(input, { target: { value: "tacos" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(screen.getByText("tacos")).toBeTruthy());
  });

  it("opens the general composer, creates a brand-new category with its first item, and closes", async () => {
    // Zero categories exist yet, so TaskCategoryEditor starts directly in
    // its create-mode (see Task 7) — there's no "Category" select to pick
    // from until one exists.
    renderView();
    await waitFor(() => expect(screen.getByRole("button", { name: /add item/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));

    fireEvent.change(screen.getByLabelText("Item title"), { target: { value: "climb Fuji" } });
    fireEvent.change(screen.getByLabelText("New category name"), { target: { value: "To Go" } });
    fireEvent.keyDown(screen.getByLabelText("New category name"), { key: "Enter" });

    await waitFor(() => expect(screen.getByLabelText("Category")).toBeTruthy()); // back to select — category created
    fireEvent.submit(screen.getByLabelText("Item title").closest("form")!);

    await waitFor(() => expect(screen.getByText("To Go")).toBeTruthy());
    expect(screen.getByText("climb Fuji")).toBeTruthy();
    expect(screen.queryByLabelText("Item title")).toBeNull(); // composer closed
  });

  it("reuses an existing category's casing when a case-insensitive match is created via the composer", async () => {
    renderView([makeTask({ id: "1", title: "sushi", scope: { kind: "bucket", categoryId: "c-eat" } })], [toEat]);
    await waitFor(() => expect(screen.getByText("To Eat")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));

    fireEvent.change(screen.getByLabelText("Item title"), { target: { value: "ramen" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "__new__" } });
    fireEvent.change(screen.getByLabelText("New category name"), { target: { value: "to eat" } });
    fireEvent.keyDown(screen.getByLabelText("New category name"), { key: "Enter" });

    await waitFor(() => expect(screen.getByLabelText("Category")).toHaveValue("c-eat"));
    fireEvent.submit(screen.getByLabelText("Item title").closest("form")!);

    await waitFor(() => expect(screen.getByText("ramen")).toBeTruthy());
    expect(screen.getAllByText("To Eat")).toHaveLength(1); // one section, not two
    expect(screen.queryByText("to eat")).toBeNull();
  });

  it("rejects an empty title or category without creating anything", async () => {
    renderView();
    await waitFor(() => expect(screen.getByRole("button", { name: /add item/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));

    fireEvent.submit(screen.getByLabelText("Item title").closest("form")!);
    expect(screen.getByText(/title is required/i)).toBeTruthy();
    expect(screen.getByLabelText("Item title")).toBeTruthy(); // composer still open

    fireEvent.change(screen.getByLabelText("Item title"), { target: { value: "climb Fuji" } });
    fireEvent.submit(screen.getByLabelText("Item title").closest("form")!);
    expect(screen.getByText(/category is required/i)).toBeTruthy();
  });

  it("Escape closes the composer without creating anything", async () => {
    renderView();
    await waitFor(() => expect(screen.getByRole("button", { name: /add item/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));
    fireEvent.change(screen.getByLabelText("Item title"), { target: { value: "climb Fuji" } });

    fireEvent.keyDown(screen.getByLabelText("Item title"), { key: "Escape" });
    expect(screen.queryByLabelText("Item title")).toBeNull();
    expect(screen.queryByText("climb Fuji")).toBeNull();
  });

  it("includes a submit button in the general composer form, so a real browser's implicit Enter-to-submit isn't suppressed", async () => {
    // The composer form has two+ fields (title, plus TaskCategoryEditor's
    // select-or-create-input) and no visible submit button. Per the HTML
    // Standard's implicit-submission algorithm, a form with more than one
    // text field and no submit button suppresses Enter-to-submit entirely in
    // real browsers — jsdom does not emulate this suppression, so the
    // meaningful, browser-accurate assertion is structural: a submit button
    // must exist in the DOM, since its mere presence is what restores
    // Enter-to-submit for every field in the form.
    renderView();
    await waitFor(() => expect(screen.getByRole("button", { name: /add item/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));

    const form = screen.getByLabelText("Item title").closest("form")!;
    const submitButton = form.querySelector('button[type="submit"]');
    expect(submitButton).not.toBeNull();
  });
});
```

This drops the old "caps the composer's category input at 60 characters" test — the composer no longer has a free-text category input for an existing category (that's now a `<select>`, where `maxLength` is meaningless), and the "New category name" input's own `maxLength={60}` is already covered by `task-category-editor.test.tsx` (Task 7). Testing it again here would just be redundant coverage of the same component.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/tasks/components/bucket-category-section.test.tsx src/features/tasks/components/views/bucket-list-view.test.tsx`
Expected: FAIL — components still take the old string-category props.

- [ ] **Step 3: Update `bucket-category-section.tsx`**

```typescript
"use client";

import { Plus } from "lucide-react";

import type { Task } from "../types";
import { BucketItemRow } from "./bucket-item-row";
import { QuickAdd } from "./quick-add";

export function BucketCategorySection({
  categoryId,
  categoryName,
  active,
  completed,
  onToggle,
  onSelect,
  onDelete,
  onAddItem,
}: {
  categoryId: string;
  categoryName: string;
  active: Task[];
  completed: Task[];
  onToggle: (taskId: string) => void;
  onSelect: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onAddItem: (title: string) => void;
}) {
  const total = active.length + completed.length;

  return (
    <section className="space-y-2 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">
          {categoryName}
        </h3>
        <span className="text-[11px] font-medium text-subtle">
          {total} {total === 1 ? "item" : "items"}
        </span>
      </div>
      <ul>
        {[...active, ...completed].map((task) => (
          <BucketItemRow
            key={task.id}
            task={task}
            onToggle={() => onToggle(task.id)}
            onSelect={() => onSelect(task.id)}
            onDelete={() => onDelete(task.id)}
          />
        ))}
      </ul>
      <div className="group flex h-10 items-center gap-2.5 rounded-md px-1.5 text-foreground/70 transition-colors duration-200 hover:bg-muted/40 focus-within:bg-muted/40">
        <Plus
          className="size-3.5 shrink-0 transition-colors duration-200 group-hover:text-amber group-focus-within:text-amber"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <QuickAdd onAdd={onAddItem} placeholder="Add item" ariaLabel={`Add item to ${categoryName}`} />
        </div>
      </div>
    </section>
  );
}
```

(only the props/references change — `categoryId` is accepted for the `key` in the caller and isn't otherwise used inside this component, since it has no need to look anything up by id internally)

- [ ] **Step 4: Update `bucket-list-view.tsx`**

```typescript
"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";

import { groupBucketTasks } from "../../lib/categories";
import { useTasks } from "../../store";
import { BucketCategorySection } from "../bucket-category-section";
import { TaskCategoryEditor } from "../task-category-editor";
import { TaskDetailDrawer } from "../task-detail-drawer";
import { taskItemHandlers } from "../task-item";
import type { CalendarViewProps } from "./weekly-view";

// anchor/onAnchorChange/onDrillDown are part of CalendarViewProps (every
// view in VIEW_COMPONENTS shares that shape) but a bucket list has no
// anchor date to page through, so this view simply doesn't use them.
export function BucketListView(_props: CalendarViewProps) {
  const actions = useTasks();
  const { tasks, categories } = actions;
  const groups = groupBucketTasks(tasks, categories);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const [composerOpen, setComposerOpen] = useState(false);
  const [composerTitle, setComposerTitle] = useState("");
  const [composerCategoryId, setComposerCategoryId] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);

  const closeComposer = () => {
    setComposerOpen(false);
    setComposerTitle("");
    setComposerCategoryId("");
    setComposerError(null);
  };

  const submitComposer = () => {
    const title = composerTitle.trim();
    if (!title) {
      setComposerError("Title is required.");
      return;
    }
    if (!composerCategoryId) {
      setComposerError("Category is required.");
      return;
    }
    actions.addBucketItem(title, composerCategoryId);
    closeComposer();
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-2 overflow-y-auto transition-[padding-right] duration-200 ease-out",
        selectedTask && "pr-[400px]",
      )}
    >
      <p className="text-sm text-subtle">Things to do, eat, visit, or remember — no schedule needed.</p>

      {groups.length === 0 ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">Your bucket list is empty</p>
          <p className="text-sm text-subtle">Add something you want to do, try, visit, or remember.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <BucketCategorySection
              key={group.categoryId}
              categoryId={group.categoryId}
              categoryName={group.categoryName}
              active={group.active}
              completed={group.completed}
              onToggle={(taskId) => actions.toggleTask(taskId)}
              onSelect={(taskId) => setSelectedTaskId(taskId)}
              onDelete={(taskId) => actions.removeTask(taskId)}
              onAddItem={(title) => actions.addBucketItem(title, group.categoryId)}
            />
          ))}
        </div>
      )}

      {composerOpen ? (
        <form
          className="space-y-2 rounded-md border border-input p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submitComposer();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              closeComposer();
            }
          }}
        >
          <input
            value={composerTitle}
            onChange={(e) => setComposerTitle(e.target.value)}
            placeholder="Item title"
            aria-label="Item title"
            autoFocus
            className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <TaskCategoryEditor
            categoryId={composerCategoryId}
            categories={categories}
            onCategoryChange={setComposerCategoryId}
            onCreateCategory={actions.createCategory}
          />
          {composerError && <p className="text-xs text-destructive">{composerError}</p>}
          {/* No visible submit button by design, but a form with more than
              one text field and no submit button suppresses a real browser's
              implicit Enter-to-submit entirely (per the HTML Standard). This
              sr-only button restores Enter-to-submit for every field without
              changing the visual design. */}
          <button type="submit" className="sr-only">
            Add item
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setComposerOpen(true)}
          className="group flex h-10 w-fit items-center gap-2.5 rounded-md px-1.5 text-foreground/70 outline-none transition-colors duration-200 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Plus
            className="size-3.5 shrink-0 transition-colors duration-200 group-hover:text-amber group-focus-visible:text-amber"
            aria-hidden
          />
          Add item
        </button>
      )}

      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          categories={categories}
          onClose={() => setSelectedTaskId(null)}
          {...taskItemHandlers(selectedTask.id, actions)}
        />
      )}
    </div>
  );
}
```

Notes on this version:
- The composer's category field is now `TaskCategoryEditor` itself (reused, not a second hand-rolled implementation) — `TaskCategoryEditor`'s own "starts in create mode when `categories.length === 0`" behavior (Task 7) means a brand-new user with zero categories sees the name-input immediately here too, with no special-casing needed in this file.
- `TaskCategoryEditor`'s create-mode UI (Task 7) is deliberately a `<div>`, not a nested `<form>` — since this composer is itself a `<form>`, and HTML forbids nesting `<form>` inside `<form>`, `TaskCategoryEditor` was already built without one so it composes safely here with no further changes needed.

- [ ] **Step 4: Run the tests and full typecheck**

Run: `cd frontend && npx vitest run`
Expected: PASS — the entire frontend suite, pristine output, no leftover references to the old string-category shape anywhere.

Run: `cd frontend && npx tsc --noEmit`
Expected: clean, no errors anywhere.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/bucket-category-section.tsx frontend/src/features/tasks/components/bucket-category-section.test.tsx frontend/src/features/tasks/components/views/bucket-list-view.tsx frontend/src/features/tasks/components/views/bucket-list-view.test.tsx
git commit -m "feat: wire the Bucket List page onto real, persistent categories"
```

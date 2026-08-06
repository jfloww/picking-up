# Task Timestamp Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `Task.created_at` and `Task.completed_at` from client-writable `CharField`s to server-authoritative `DateTimeField`s, migrating existing data without loss or downtime.

**Architecture:** A 3-migration shadow-field sequence (add nullable `DateTimeField` columns → `RunPython` backfill parsing the old string columns, falling back to `updated_at` on parse failure → remove the old columns and rename the shadow columns into place, finalizing `created_at` as non-nullable `auto_now_add=True`). `TaskSerializer` marks both fields read-only and derives `completed_at` from the `done` field's transition in `create()`/`update()`, mirroring the existing reference pattern already used by `Category.created_at`.

**Tech Stack:** Django 5.1 (`Django>=5.1,<6.0`), Django REST Framework, Oracle in production (SQLite likely for local dev — this is why the migration uses the safe shadow-field pattern instead of a bare `AlterField`, which doesn't generate a safe string→datetime data conversion and can't be trusted to cast implicitly across backends).

## Global Constraints

- No bare in-place `AlterField` for the type change — use the 3-file shadow-field pattern (matches this repo's existing `0004`/`0005` bucket-category-backfill precedent).
- `created_at` becomes fully read-only (`auto_now_add=True`), no client override path (YAGNI — no historical-import feature exists yet).
- `completed_at` is server-derived from the `done` field's transition: set to `timezone.now()` on False→True, cleared to `None` on True→False. This must be handled in **both** `create()` (a task can be created already-`done=True`) and `update()` (existing override already handles `id` immutability).
- Parse-failure fallback during backfill: fall back to the row's `updated_at` value, log the task ID via the `logging` module — never abort the migration, never guess.
- No frontend changes (verified: `store.tsx` never reads timestamp fields back from `create`/`update` responses).
- No change to `Category`'s timestamp handling or `Task.updated_at`'s `auto_now=True` behavior.

---

## File Structure

- Create: `backend/apps/tasks/migrations/0007_task_timestamps_shadow_fields.py` — adds nullable `created_at_dt`/`completed_at_dt` shadow columns.
- Create: `backend/apps/tasks/migrations/0008_backfill_task_timestamps.py` — `RunPython` backfill, old string columns → shadow columns.
- Create: `backend/apps/tasks/migrations/0009_task_timestamps_finalize.py` — removes old columns, renames shadow columns into place, finalizes `created_at` as non-nullable `auto_now_add=True`.
- Modify: `backend/apps/tasks/models.py:51-52` — field type declarations must match the post-0009 schema.
- Modify: `backend/apps/tasks/tests.py` — new `BackfillTaskTimestampsMigrationTests` class; new API tests; fixes to 3 existing tests whose assertions depend on the old client-writable behavior.
- Modify: `backend/apps/tasks/serializers.py` — `completed_at` override deleted, `read_only_fields` added, `create()` added, `update()` extended.

---

### Task 1: Migrations — CharField to DateTimeField, with data preserved

**Files:**
- Create: `backend/apps/tasks/migrations/0007_task_timestamps_shadow_fields.py`
- Create: `backend/apps/tasks/migrations/0008_backfill_task_timestamps.py`
- Create: `backend/apps/tasks/migrations/0009_task_timestamps_finalize.py`
- Modify: `backend/apps/tasks/models.py:51-52`
- Test: `backend/apps/tasks/tests.py` (new class, inserted after line 540, before `class CategoryApiTests(TestCase):` at line 543 — this alphabetical position, `BackfillTaskTimestampsMigrationTests` sorting after `BackfillTaskOrderMigrationTests` and before `CategoryApiTests`, means it runs last among the migration tests and ends at the true-latest migration, so — like `BackfillTaskOrderMigrationTests` — it needs no explicit rollback-to-latest cleanup at its end, unlike `BackfillBucketCategoriesMigrationTests` which does)

**Interfaces:**
- Produces: `Task.created_at` (`DateTimeField(auto_now_add=True)`, non-nullable) and `Task.completed_at` (`DateTimeField(null=True, blank=True)`) — the exact model field declarations Task 2's serializer work depends on.

- [ ] **Step 1: Write the failing migration test**

Open `backend/apps/tasks/tests.py`. Insert this new class after line 540 (`self.assertLess(by_title["second"], by_title["third"])`) and before line 542's blank line / `class CategoryApiTests(TestCase):`:

```python
class BackfillTaskTimestampsMigrationTests(TransactionTestCase):
    def test_backfills_parsed_timestamps_and_falls_back_to_updated_at_on_bad_data(self):
        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0007_task_timestamps_shadow_fields")])

        old_state = executor.loader.project_state([("tasks", "0007_task_timestamps_shadow_fields")])
        OldUser = old_state.apps.get_model("auth", "User")
        OldTask = old_state.apps.get_model("tasks", "Task")

        user = OldUser.objects.create(username="ts@example.com", email="ts@example.com")

        valid = OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="valid", scope_kind="day",
            scope_value="2026-07-27", created_at="2026-07-27T09:00:00.000Z",
            completed_at="2026-07-27T10:00:00.000Z",
        )
        garbage_created = OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="garbage created", scope_kind="day",
            scope_value="2026-07-27", created_at="not-a-date",
        )
        garbage_completed = OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="garbage completed", scope_kind="day",
            scope_value="2026-07-27", created_at="2026-07-27T09:00:00.000Z",
            completed_at="also-not-a-date",
        )
        never_completed = OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="never completed", scope_kind="day",
            scope_value="2026-07-27", created_at="2026-07-27T09:00:00.000Z",
            completed_at=None,
        )

        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0009_task_timestamps_finalize")])

        new_state = executor.loader.project_state([("tasks", "0009_task_timestamps_finalize")])
        NewTask = new_state.apps.get_model("tasks", "Task")

        new_valid = NewTask.objects.get(id=valid.id)
        self.assertEqual(new_valid.created_at.isoformat(), "2026-07-27T09:00:00+00:00")
        self.assertEqual(new_valid.completed_at.isoformat(), "2026-07-27T10:00:00+00:00")

        new_garbage_created = NewTask.objects.get(id=garbage_created.id)
        self.assertEqual(new_garbage_created.created_at, new_garbage_created.updated_at)

        new_garbage_completed = NewTask.objects.get(id=garbage_completed.id)
        self.assertEqual(new_garbage_completed.completed_at, new_garbage_completed.updated_at)

        new_never_completed = NewTask.objects.get(id=never_completed.id)
        self.assertIsNone(new_never_completed.completed_at)
```

This relies on the same `uuid_module`, `connection`, `MigrationExecutor`, `TransactionTestCase` names already imported at lines 428-433 for the existing migration tests — no new imports needed for this class itself.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && .venv/Scripts/python manage.py test apps.tasks.tests.BackfillTaskTimestampsMigrationTests -v 2`
Expected: FAIL — `NodeNotFoundError` (or similar), because migration `0007_task_timestamps_shadow_fields` doesn't exist yet.

- [ ] **Step 3: Write migration 0007 — add nullable shadow columns**

Create `backend/apps/tasks/migrations/0007_task_timestamps_shadow_fields.py`:

```python
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
```

- [ ] **Step 4: Write migration 0008 — backfill the shadow columns**

Create `backend/apps/tasks/migrations/0008_backfill_task_timestamps.py`:

```python
import logging
from datetime import timezone as dt_timezone

from django.db import migrations
from django.utils.dateparse import parse_datetime

logger = logging.getLogger(__name__)


def backfill_timestamps(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")

    for task in Task.objects.all():
        created = parse_datetime(task.created_at or "")
        if created is None:
            logger.warning(
                "Task %s: unparseable created_at %r, falling back to updated_at",
                task.id, task.created_at,
            )
            created = task.updated_at
        elif created.tzinfo is None:
            created = created.replace(tzinfo=dt_timezone.utc)
        task.created_at_dt = created

        if task.completed_at:
            completed = parse_datetime(task.completed_at)
            if completed is None:
                logger.warning(
                    "Task %s: unparseable completed_at %r, falling back to updated_at",
                    task.id, task.completed_at,
                )
                completed = task.updated_at
            elif completed.tzinfo is None:
                completed = completed.replace(tzinfo=dt_timezone.utc)
            task.completed_at_dt = completed
        else:
            task.completed_at_dt = None

        task.save(update_fields=["created_at_dt", "completed_at_dt"])


class Migration(migrations.Migration):

    dependencies = [
        ("tasks", "0007_task_timestamps_shadow_fields"),
    ]

    operations = [
        migrations.RunPython(backfill_timestamps, migrations.RunPython.noop),
    ]
```

`task.save(update_fields=["created_at_dt", "completed_at_dt"])` deliberately excludes `updated_at` from `update_fields`, so this backfill save does not disturb the `auto_now=True` `updated_at` value being used as this row's own fallback.

- [ ] **Step 5: Write migration 0009 — finalize the column swap**

Create `backend/apps/tasks/migrations/0009_task_timestamps_finalize.py`:

```python
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tasks", "0008_backfill_task_timestamps"),
    ]

    operations = [
        migrations.RemoveField(model_name="task", name="created_at"),
        migrations.RemoveField(model_name="task", name="completed_at"),
        migrations.RenameField(model_name="task", old_name="created_at_dt", new_name="created_at"),
        migrations.RenameField(model_name="task", old_name="completed_at_dt", new_name="completed_at"),
        migrations.AlterField(
            model_name="task",
            name="created_at",
            field=models.DateTimeField(auto_now_add=True),
        ),
        migrations.AlterField(
            model_name="task",
            name="completed_at",
            field=models.DateTimeField(null=True, blank=True),
        ),
    ]
```

- [ ] **Step 6: Update `models.py` to match the post-0009 schema**

In `backend/apps/tasks/models.py`, replace lines 51-52:

```python
    created_at = models.CharField(max_length=32)
    completed_at = models.CharField(max_length=32, blank=True, null=True)
```

with:

```python
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
```

- [ ] **Step 7: Confirm no migration drift**

Run: `cd backend && .venv/Scripts/python manage.py makemigrations --check --dry-run`
Expected: `No changes detected` — confirms `models.py` and the 3 new migrations agree on the final schema.

- [ ] **Step 8: Run the migration test to verify it passes**

Run: `cd backend && .venv/Scripts/python manage.py test apps.tasks.tests.BackfillTaskTimestampsMigrationTests -v 2`
Expected: PASS

- [ ] **Step 9: Run the full test suite to confirm nothing else is broken yet**

Run: `cd backend && .venv/Scripts/python manage.py test apps.tasks -v 2`
Expected: Several failures in `TaskApiTests` — `test_create_round_trips_every_field_including_subtasks_and_repeat_source`, `test_list_is_ordered_by_created_at`, and `test_create_rejects_values_that_violate_restored_field_constraints` — this is expected; Task 2 fixes them. No failures should occur outside `TaskApiTests`.

- [ ] **Step 10: Commit**

```bash
git add backend/apps/tasks/migrations/0007_task_timestamps_shadow_fields.py backend/apps/tasks/migrations/0008_backfill_task_timestamps.py backend/apps/tasks/migrations/0009_task_timestamps_finalize.py backend/apps/tasks/models.py backend/apps/tasks/tests.py
git commit -m "feat: migrate Task.created_at/completed_at from CharField to DateTimeField"
```

---

### Task 2: Serializer — read-only timestamps, server-derived completed_at

**Files:**
- Modify: `backend/apps/tasks/serializers.py:1` (imports), `serializers.py:33-35` (delete `completed_at` override), `serializers.py:60-84` (`Meta`), `serializers.py:103-110` (`update()`, plus new `create()`)
- Modify: `backend/apps/tasks/tests.py` (imports; fixes to 3 existing tests; 4 new tests)

**Interfaces:**
- Consumes: `Task.created_at` / `Task.completed_at` as real `DateTimeField`s (Task 1).
- Produces: `TaskSerializer` where `created_at`/`completed_at` are present in API responses but rejected as client input; `completed_at` is set to `timezone.now()` whenever a task's `done` becomes `True` (on create or update) and cleared to `None` whenever `done` becomes `False`.

- [ ] **Step 1: Write the failing API tests**

In `backend/apps/tasks/tests.py`, insert these 4 new test methods after `test_create_rejects_values_that_violate_restored_field_constraints` (ends at line 342) and before `test_create_rejects_a_subtask_missing_a_required_key` (line 344):

```python
    def test_create_ignores_a_client_supplied_created_at(self):
        owner, client = auth_client()
        task_id = str(uuid.uuid4())
        before = timezone.now()

        response = client.post(
            "/api/tasks/",
            make_task_payload(id=task_id, created_at="2020-01-01T00:00:00.000Z"),
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        stored = Task.objects.get(id=task_id)
        self.assertGreaterEqual(stored.created_at, before)

    def test_patching_done_to_true_sets_completed_at(self):
        owner, client = auth_client()
        task_id = str(uuid.uuid4())
        client.post("/api/tasks/", make_task_payload(id=task_id, done=False), format="json")
        before = timezone.now()

        response = client.patch(f"/api/tasks/{task_id}/", {"done": True}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        stored = Task.objects.get(id=task_id)
        self.assertTrue(stored.done)
        self.assertIsNotNone(stored.completed_at)
        self.assertGreaterEqual(stored.completed_at, before)

    def test_patching_done_to_false_clears_completed_at(self):
        owner, client = auth_client()
        task_id = str(uuid.uuid4())
        client.post("/api/tasks/", make_task_payload(id=task_id, done=True), format="json")
        self.assertIsNotNone(Task.objects.get(id=task_id).completed_at)

        response = client.patch(f"/api/tasks/{task_id}/", {"done": False}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        stored = Task.objects.get(id=task_id)
        self.assertFalse(stored.done)
        self.assertIsNone(stored.completed_at)

    def test_patching_an_explicit_completed_at_is_silently_dropped_not_rejected(self):
        owner, client = auth_client()
        task_id = str(uuid.uuid4())
        client.post("/api/tasks/", make_task_payload(id=task_id, done=False), format="json")

        response = client.patch(
            f"/api/tasks/{task_id}/",
            {"completed_at": "2020-01-01T00:00:00.000Z"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        stored = Task.objects.get(id=task_id)
        self.assertIsNone(stored.completed_at)
```

These use `timezone.now()`, not yet imported — added in Step 2 below.

- [ ] **Step 2: Add the new imports these tests need**

In `backend/apps/tasks/tests.py`, replace lines 1-8:

```python
import uuid

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from .models import Category, Task
```

with:

```python
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Category, Task
```

(Two new lines added: `from datetime import datetime, timedelta, timezone as dt_timezone`, and `from django.utils import timezone` — everything else is unchanged.)

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `cd backend && .venv/Scripts/python manage.py test apps.tasks.tests.TaskApiTests.test_create_ignores_a_client_supplied_created_at apps.tasks.tests.TaskApiTests.test_patching_done_to_true_sets_completed_at apps.tasks.tests.TaskApiTests.test_patching_done_to_false_clears_completed_at apps.tasks.tests.TaskApiTests.test_patching_an_explicit_completed_at_is_silently_dropped_not_rejected -v 2`
Expected: FAIL — `created_at`/`completed_at` are still client-writable at this point (no `read_only_fields` yet), so `test_create_ignores_a_client_supplied_created_at` fails (stored value is the 2020 date, not `>= before`), and the `done`-transition tests fail (`completed_at` stays whatever the client sent, or `None`, since nothing derives it yet).

- [ ] **Step 4: Update the serializer's imports and delete the `completed_at` override**

In `backend/apps/tasks/serializers.py`, replace line 1:

```python
from rest_framework import serializers
```

with:

```python
from django.utils import timezone
from rest_framework import serializers
```

Then delete lines 33-35:

```python
    completed_at = serializers.CharField(
        required=False, allow_null=True, allow_blank=True, default=None, max_length=32,
    )
```

(Removing this override falls back to the auto-generated `DateTimeField` DRF derives from the model field.)

- [ ] **Step 5: Add `read_only_fields` to `Meta`**

In `backend/apps/tasks/serializers.py`, the `Meta.fields` tuple ends with:

```python
            "order",
        )
```

Change it to:

```python
            "order",
        )
        read_only_fields = ("created_at", "completed_at")
```

- [ ] **Step 6: Add `create()` and extend `update()` to derive `completed_at`**

In `backend/apps/tasks/serializers.py`, replace the existing `update()` method (originally lines 103-110):

```python
    def update(self, instance, validated_data):
        # `id` is identity, not a mutable field — the URL's pk is authoritative
        # on PUT. Without this, DRF's default ModelSerializer.update() would
        # setattr(instance, "id", <body's id>) and instance.save() would then
        # UPDATE ... WHERE id = <that other id>, silently overwriting
        # whatever row already has that id (see task-1 security review).
        validated_data.pop("id", None)
        return super().update(instance, validated_data)
```

with:

```python
    def create(self, validated_data):
        if validated_data.get("done"):
            validated_data["completed_at"] = timezone.now()
        return super().create(validated_data)

    def update(self, instance, validated_data):
        # `id` is identity, not a mutable field — the URL's pk is authoritative
        # on PUT. Without this, DRF's default ModelSerializer.update() would
        # setattr(instance, "id", <body's id>) and instance.save() would then
        # UPDATE ... WHERE id = <that other id>, silently overwriting
        # whatever row already has that id (see task-1 security review).
        validated_data.pop("id", None)
        if "done" in validated_data and validated_data["done"] != instance.done:
            validated_data["completed_at"] = timezone.now() if validated_data["done"] else None
        return super().update(instance, validated_data)
```

`completed_at` is excluded from `Meta.fields`' writable set by `read_only_fields`, so DRF never puts a client-supplied `completed_at` into `validated_data` — setting it here is the only way it reaches the model.

- [ ] **Step 7: Run the new tests to verify they pass**

Run: `cd backend && .venv/Scripts/python manage.py test apps.tasks.tests.TaskApiTests.test_create_ignores_a_client_supplied_created_at apps.tasks.tests.TaskApiTests.test_patching_done_to_true_sets_completed_at apps.tasks.tests.TaskApiTests.test_patching_done_to_false_clears_completed_at apps.tasks.tests.TaskApiTests.test_patching_an_explicit_completed_at_is_silently_dropped_not_rejected -v 2`
Expected: PASS

- [ ] **Step 8: Fix `test_create_round_trips_every_field_including_subtasks_and_repeat_source`**

This test creates a task with `done=True` directly (via `create()`, not `update()`), so with Step 6's `create()` override, `completed_at` is now set to `timezone.now()` — no longer the literal string the test used to send. In `backend/apps/tasks/tests.py`, remove the now-inert `completed_at=` line from the payload (originally line 90):

```python
                completed_at="2026-07-27T09:00:00.000Z",
```

Delete this line entirely from the `make_task_payload(...)` call.

Then replace the exact-string assertion (originally line 110):

```python
        self.assertEqual(stored.completed_at, "2026-07-27T09:00:00.000Z")
```

with:

```python
        self.assertIsNotNone(stored.completed_at)
        self.assertLess(timezone.now() - stored.completed_at, timedelta(seconds=5))
```

- [ ] **Step 9: Redesign `test_list_is_ordered_by_created_at`**

`created_at` is now server-controlled, so a client can no longer invert list order by sending explicit values at creation time. Replace the whole test (originally lines 303-318):

```python
    def test_list_is_ordered_by_created_at(self):
        owner, client = auth_client()
        client.post(
            "/api/tasks/",
            make_task_payload(id=str(uuid.uuid4()), title="second", created_at="2026-07-27T10:00:00.000Z"),
            format="json",
        )
        client.post(
            "/api/tasks/",
            make_task_payload(id=str(uuid.uuid4()), title="first", created_at="2026-07-27T09:00:00.000Z"),
            format="json",
        )

        response = client.get("/api/tasks/")

        self.assertEqual([t["title"] for t in response.data], ["first", "second"])
```

with:

```python
    def test_list_is_ordered_by_created_at(self):
        owner, client = auth_client()
        first_id = str(uuid.uuid4())
        second_id = str(uuid.uuid4())
        client.post("/api/tasks/", make_task_payload(id=first_id, title="second"), format="json")
        client.post("/api/tasks/", make_task_payload(id=second_id, title="first"), format="json")

        # created_at is server-controlled now, so invert the stored order
        # directly at the DB level (bypassing the read-only serializer field)
        # to prove the list endpoint sorts by the created_at column itself,
        # not by request/insertion order.
        Task.objects.filter(id=first_id).update(
            created_at=datetime(2026, 7, 27, 10, 0, tzinfo=dt_timezone.utc)
        )
        Task.objects.filter(id=second_id).update(
            created_at=datetime(2026, 7, 27, 9, 0, tzinfo=dt_timezone.utc)
        )

        response = client.get("/api/tasks/")

        self.assertEqual([t["title"] for t in response.data], ["first", "second"])
```

- [ ] **Step 10: Fix `test_create_rejects_values_that_violate_restored_field_constraints`**

`completed_at` is now read-only, so DRF silently drops an out-of-range value instead of validating and rejecting it — there is no longer a constraint to violate here. In `backend/apps/tasks/tests.py`, delete this block (originally lines 335-338) from the test:

```python
        self.assertEqual(
            client.post("/api/tasks/", make_task_payload(completed_at="x" * 33), format="json").status_code,
            400,
        )
```

The test's other 4 assertions (`rolled_from_value`, `time`, `due_date`, `duration_minutes`) are untouched by this change and stay exactly as they are.

- [ ] **Step 11: Run the full app test suite**

Run: `cd backend && .venv/Scripts/python manage.py test apps.tasks -v 2`
Expected: PASS — all tests green, including the 3 fixed tests, the 4 new tests, and `BackfillTaskTimestampsMigrationTests` from Task 1.

- [ ] **Step 12: Commit**

```bash
git add backend/apps/tasks/serializers.py backend/apps/tasks/tests.py
git commit -m "feat: derive Task.completed_at server-side from the done transition"
```

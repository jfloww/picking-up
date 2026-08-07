# RF-005 Phase 1 Occurrence Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the client-owned, two-step (occurrence write + anchor write) sequences behind Detach, Delete-occurrence, and Reschedule with three atomic, versioned server commands, following the existing Nest/Promote pattern.

**Architecture:** One `services.py` function per command wrapped in `@transaction.atomic`, reusing `_lock_user`/`_locked_owned_tasks`; one command serializer per command; one `APIView` per command at `POST /api/tasks/{id}/commands/<verb>/`; a Next.js BFF route per command that passes through Django's status/body verbatim; frontend `TaskRepository` methods (API + localStorage + fake) and `store.tsx` wiring that mirrors `convertTaskToSubtask`/`promoteSubtaskToTask`'s optimistic-update + `enqueueMutation` + `applyCommandState` + generation-reconciliation shape.

**Tech Stack:** Django REST Framework (backend/apps/tasks), Next.js App Router route handlers (frontend/src/app/api), React state via a custom store hook (frontend/src/features/tasks/store.tsx), Vitest (frontend), Django's `TestCase` (backend).

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-08-06-rf005-occurrence-commands-design.md`. Every rule below traces to a section there.
- No `anchor_version` precondition — the anchor write is an additive set-union, gated only by the owner-row lock (`_lock_user`), never by a client-supplied version.
- `404 Not Found` for a missing or cross-owner primary task, matching Nest/Promote (never disclose existence via a different status).
- Backend tests run via: `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks -v 2` from `backend/` (forces SQLite locally — the default `.env` points at Oracle, which this sandbox cannot reach; matches CI's forcing behavior).
- Frontend tests run via `npx vitest run <path>` from `frontend/`.
- Every new backend command view/serializer/URL follows the exact shape of `NestTaskCommandView`/`NestTaskCommandSerializer` in `backend/apps/tasks/views.py` and `backend/apps/tasks/serializers.py` — do not invent a different error/response convention.
- Every new frontend command follows the exact shape of `convertTaskToSubtask` in `frontend/src/features/tasks/store.tsx` (optimistic `applyCommandState`, `nextMutationGeneration`, `enqueueMutation`, post-response reconciliation against `mutationGenerationsRef`).
- `_append_anchor_exclusion`'s date-to-exclude uses the task's *current effective date* (`_current_effective_date`: `scope_value` when day-scoped, `rolled_from_value` when a rolled-over week-scoped task), not just `scope_value`. This is a deliberate, small scope extension beyond a literal port: today's client-side `detachFromRoutine`/`removeTask` only exclude when `scope.kind === "day"`, silently skipping a rolled-over occurrence — a real gap, not an intentional narrowing (confirmed by reading `rescheduleTaskToDay`, which already handles both cases). This plan closes that gap for all three commands instead of porting it forward. Flagged here so it isn't mistaken for scope creep discovered later.

---

## File Structure

**Backend (`backend/apps/tasks/`):**
- `services.py` — add `_current_effective_date`, `_append_anchor_exclusion`, `detach_task`, `delete_occurrence`, `reschedule_task`, plus `DetachTaskResult`/`DeleteOccurrenceResult`/`RescheduleTaskResult` dataclasses.
- `serializers.py` — add `DetachTaskCommandSerializer`, `DeleteOccurrenceCommandSerializer`, `RescheduleTaskCommandSerializer`.
- `views.py` — add `DetachTaskCommandView`, `DeleteOccurrenceCommandView`, `RescheduleTaskCommandView`.
- `../../config/urls.py` — register the three new command paths.
- `tests.py` — extend `TaskCommandApiTests` with `detach()`/`delete_occurrence()`/`reschedule()` helper methods and their test cases.

**Frontend:**
- `frontend/src/features/tasks/data/repository.ts` — add `DetachTaskCommand`/`Result`, `DeleteOccurrenceCommand`/`Result`, `RescheduleTaskCommand`/`Result` types, three new `TaskRepository` methods, three `createLocalStorageRepository` implementations.
- `frontend/src/features/tasks/data/api-task-repository.ts` — three `createApiTaskRepository` implementations.
- `frontend/src/features/tasks/api/tasks.ts` — three `requestX` functions (BFF → Django).
- `frontend/src/app/api/tasks/[id]/commands/detach/route.ts`, `.../delete-occurrence/route.ts`, `.../reschedule/route.ts` — new Next.js route handlers.
- `frontend/src/features/tasks/test-utils.tsx` — three `fakeRepository` implementations.
- `frontend/src/features/tasks/store.tsx` — rewrite `detachFromRoutine`, `removeTask`, `rescheduleTaskToDay` to call the new commands instead of two `persistUpdate` calls.
- Tests: `frontend/src/features/tasks/data/repository.test.ts`, `api-task-repository.test.ts`, `store.test.tsx` — extend existing describe blocks; no new files.

---

## Task 1: Backend — Detach command

**Files:**
- Modify: `backend/apps/tasks/services.py`
- Modify: `backend/apps/tasks/serializers.py`
- Modify: `backend/apps/tasks/views.py`
- Modify: `backend/config/urls.py`
- Test: `backend/apps/tasks/tests.py`

**Interfaces:**
- Produces: `services.py`'s `_current_effective_date(task) -> str | None`, `_append_anchor_exclusion(user, occurrence) -> Task | None`, `detach_task(*, user, occurrence_id, occurrence_version: int, repeat_weekdays: list[int] | None) -> DetachTaskResult` where `DetachTaskResult` has fields `occurrence: Task`, `anchor: Task | None`. These three names are reused by Tasks 2 and 3 — do not rename them there.
- Consumes: `_lock_user`, `_locked_owned_tasks`, `_assert_versions`, `TaskCommandNotFound`, `TaskVersionConflict`, `TaskCommandConflict` — all already in `services.py`.

- [ ] **Step 1: Write the failing service-level behavior as an HTTP-level test**

Add to `backend/apps/tasks/tests.py`, inside `TaskCommandApiTests` (alongside the existing `nest`/`promote` helper methods):

```python
    def detach(self, occurrence, **overrides):
        payload = {"occurrence_version": occurrence.version}
        payload.update(overrides)
        return self.client.post(
            f"/api/tasks/{occurrence.id}/commands/detach/",
            payload,
            format="json",
        )

    def test_detach_clears_repeat_source_and_excludes_the_date_on_the_anchor(self):
        anchor = self.create_task(
            title="gym", scope_value="2026-07-01", repeat_weekdays=[4],
        )
        occurrence = self.create_task(
            title="gym", scope_value="2026-07-16", repeat_source=str(anchor.id),
        )

        response = self.detach(occurrence)

        self.assertEqual(response.status_code, 200, response.data)
        occurrence.refresh_from_db()
        self.assertIsNone(occurrence.repeat_source_id)
        self.assertIsNone(occurrence.repeat_weekdays)
        self.assertEqual(occurrence.version, 2)
        anchor.refresh_from_db()
        self.assertEqual(anchor.excluded_dates, ["2026-07-16"])
        self.assertEqual(anchor.version, 2)
        self.assertEqual(response.data["occurrence"]["version"], 2)
        self.assertEqual(response.data["anchor"]["version"], 2)

    def test_detach_appends_to_existing_excluded_dates_rather_than_replacing_them(self):
        anchor = self.create_task(
            title="gym", scope_value="2026-07-01", repeat_weekdays=[4],
            excluded_dates=["2026-07-09"],
        )
        occurrence = self.create_task(
            title="gym", scope_value="2026-07-16", repeat_source=str(anchor.id),
        )

        self.detach(occurrence)

        anchor.refresh_from_db()
        self.assertEqual(anchor.excluded_dates, ["2026-07-09", "2026-07-16"])

    def test_detach_can_immediately_establish_a_new_repeat_schedule(self):
        occurrence = self.create_task(title="solo")

        response = self.detach(occurrence, repeat_weekdays=[2, 4])

        self.assertEqual(response.status_code, 200, response.data)
        occurrence.refresh_from_db()
        self.assertEqual(occurrence.repeat_weekdays, [2, 4])

    def test_detach_on_an_already_standalone_task_touches_no_anchor(self):
        response = self.detach(self.create_task(title="solo"))

        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn("anchor", response.data)

    def test_detach_returns_409_for_a_stale_version(self):
        occurrence = self.create_task(title="solo")

        response = self.detach(occurrence, occurrence_version=occurrence.version + 1)

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "task_version_conflict")

    def test_detach_returns_404_for_a_missing_or_unowned_occurrence(self):
        response = self.client.post(
            f"/api/tasks/{uuid.uuid4()}/commands/detach/",
            {"occurrence_version": 1},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

        other_user, other_client = auth_client("detach-other@example.com")
        other_task = Task.objects.create(
            id=uuid.uuid4(), user=other_user, title="not yours",
            scope_kind="day", scope_value="2026-07-16",
        )
        response = self.detach(other_task)
        self.assertEqual(response.status_code, 404)
```

`create_task` already accepts `repeat_source`/`repeat_weekdays`/`excluded_dates` as overrides via `make_task_payload`'s `**overrides` passthrough — confirm this by reading `make_task_payload` (`backend/apps/tasks/tests.py`, top of file) before writing the test if any field name looks unfamiliar.

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks.tests.TaskCommandApiTests -v 2` from `backend/`.
Expected: every `test_detach_*` test errors with `404` (no such URL) or an `AttributeError`/`ImportError`, since none of `detach_task`, `DetachTaskCommandSerializer`, `DetachTaskCommandView`, or the URL exist yet.

- [ ] **Step 3: Implement `_current_effective_date` and `_append_anchor_exclusion` in `services.py`**

Add near the top of `backend/apps/tasks/services.py`, after `_locked_owned_tasks`:

```python
def _current_effective_date(task: Task) -> str | None:
    if task.scope_kind == "day":
        return task.scope_value
    if task.scope_kind == "week" and task.rolled_from_kind == "day":
        return task.rolled_from_value
    return None


def _append_anchor_exclusion(user, occurrence: Task) -> Task | None:
    # Additive set-union onto the anchor's excluded_dates — never a whole-
    # array replace — so a concurrent exclusion from another writer always
    # survives regardless of what this command does. No anchor_version
    # precondition: the owner-row lock (_lock_user, already held by every
    # caller) is the only concurrency guarantee this write needs, since the
    # write is idempotent (adding the same date twice is a no-op).
    anchor_id = occurrence.repeat_source_id
    if not anchor_id:
        return None
    anchors = _locked_owned_tasks(user, [anchor_id])
    anchor = anchors.get(str(anchor_id))
    if anchor is None:
        return None
    date = _current_effective_date(occurrence)
    if date is None:
        return None
    existing = set(anchor.excluded_dates or [])
    if date in existing:
        return anchor
    anchor.excluded_dates = [*(anchor.excluded_dates or []), date]
    anchor.version += 1
    anchor.save(update_fields=["excluded_dates", "version", "updated_at"])
    return anchor
```

- [ ] **Step 4: Implement `detach_task` in `services.py`**

Add after `nest_task` (or anywhere after the two helpers above):

```python
@dataclass(frozen=True)
class DetachTaskResult:
    occurrence: Task
    anchor: Task | None


@transaction.atomic
def detach_task(
    *,
    user,
    occurrence_id,
    occurrence_version: int,
    repeat_weekdays: list[int] | None,
) -> DetachTaskResult:
    _lock_user(user)
    occurrence_key = str(occurrence_id)
    tasks = _locked_owned_tasks(user, [occurrence_id])
    if occurrence_key not in tasks:
        raise TaskCommandNotFound

    occurrence = tasks[occurrence_key]
    _assert_versions({occurrence_key: occurrence_version}, tasks)

    # Must run before repeat_source is cleared below — it reads
    # occurrence.repeat_source_id to find the anchor.
    anchor = _append_anchor_exclusion(user, occurrence)

    occurrence.repeat_source = None
    occurrence.repeat_weekdays = repeat_weekdays
    occurrence.version += 1
    occurrence.save(
        update_fields=["repeat_source", "repeat_weekdays", "version", "updated_at"]
    )

    return DetachTaskResult(occurrence=occurrence, anchor=anchor)
```

- [ ] **Step 5: Add `DetachTaskCommandSerializer` to `serializers.py`**

Add near `NestTaskCommandSerializer`:

```python
class DetachTaskCommandSerializer(serializers.Serializer):
    occurrence_version = serializers.IntegerField(min_value=1)
    repeat_weekdays = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=6),
        required=False, allow_null=True, default=None,
    )
```

- [ ] **Step 6: Add `DetachTaskCommandView` to `views.py` and register the URL**

In `backend/apps/tasks/views.py`, add to the imports:

```python
from .serializers import (
    CategorySerializer,
    DetachTaskCommandSerializer,
    NestTaskCommandSerializer,
    PromoteSubtaskCommandSerializer,
    TaskSerializer,
)
from .services import (
    TaskCommandConflict,
    TaskCommandNotFound,
    TaskVersionConflict,
    detach_task,
    nest_task,
    promote_subtask,
)
```

Add the view class after `NestTaskCommandView`:

```python
class DetachTaskCommandView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request, pk):
        serializer = DetachTaskCommandSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            result = detach_task(
                user=request.user,
                occurrence_id=pk,
                occurrence_version=data["occurrence_version"],
                repeat_weekdays=data["repeat_weekdays"],
            )
        except TaskCommandNotFound as exc:
            raise NotFound from exc
        except TaskVersionConflict as exc:
            raise TaskVersionConflictResponse(exc.current_versions) from exc
        except TaskCommandConflict as exc:
            raise TaskCommandConflictResponse(exc) from exc

        body = {"occurrence": TaskSerializer(result.occurrence, context={"request": request}).data}
        if result.anchor is not None:
            body["anchor"] = TaskSerializer(result.anchor, context={"request": request}).data
        return Response(body, status=status.HTTP_200_OK)
```

In `backend/config/urls.py`, add `DetachTaskCommandView` to the import from `apps.tasks.views` and register the path immediately after the nest path:

```python
    path(
        "api/tasks/<uuid:pk>/commands/detach/",
        DetachTaskCommandView.as_view(),
        name="task-command-detach",
    ),
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks.tests.TaskCommandApiTests -v 2` from `backend/`.
Expected: PASS, all `test_detach_*` tests green, no regressions in existing nest/promote tests.

- [ ] **Step 8: Commit**

```bash
git add backend/apps/tasks/services.py backend/apps/tasks/serializers.py backend/apps/tasks/views.py backend/config/urls.py backend/apps/tasks/tests.py
git commit -m "feat: add the Detach command (RF-005 phase 1)"
```

---

## Task 2: Backend — Delete-occurrence command

**Files:**
- Modify: `backend/apps/tasks/services.py`
- Modify: `backend/apps/tasks/serializers.py`
- Modify: `backend/apps/tasks/views.py`
- Modify: `backend/config/urls.py`
- Test: `backend/apps/tasks/tests.py`

**Interfaces:**
- Consumes: `_lock_user`, `_locked_owned_tasks`, `_assert_versions`, `_append_anchor_exclusion` (Task 1).
- Produces: `delete_occurrence(*, user, occurrence_id, occurrence_version: int) -> DeleteOccurrenceResult` where `DeleteOccurrenceResult` has `removed_task_id: str`, `anchor: Task | None`.

- [ ] **Step 1: Write the failing tests**

Add to `TaskCommandApiTests` in `backend/apps/tasks/tests.py`:

```python
    def delete_occurrence(self, occurrence, **overrides):
        payload = {"occurrence_version": occurrence.version}
        payload.update(overrides)
        return self.client.post(
            f"/api/tasks/{occurrence.id}/commands/delete-occurrence/",
            payload,
            format="json",
        )

    def test_delete_occurrence_removes_the_task_and_excludes_its_date_on_the_anchor(self):
        anchor = self.create_task(
            title="gym", scope_value="2026-07-01", repeat_weekdays=[4],
        )
        occurrence = self.create_task(
            title="gym", scope_value="2026-07-16", repeat_source=str(anchor.id),
        )

        response = self.delete_occurrence(occurrence)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["removed_task_id"], str(occurrence.id))
        self.assertFalse(Task.objects.filter(id=occurrence.id).exists())
        anchor.refresh_from_db()
        self.assertEqual(anchor.excluded_dates, ["2026-07-16"])

    def test_delete_occurrence_on_a_standalone_task_touches_no_anchor(self):
        response = self.delete_occurrence(self.create_task(title="solo"))

        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn("anchor", response.data)
        self.assertFalse(Task.objects.filter(title="solo").exists())

    def test_delete_occurrence_returns_409_for_a_stale_version(self):
        occurrence = self.create_task(title="solo")

        response = self.delete_occurrence(occurrence, occurrence_version=occurrence.version + 1)

        self.assertEqual(response.status_code, 409, response.data)
        self.assertTrue(Task.objects.filter(id=occurrence.id).exists())

    def test_delete_occurrence_returns_404_for_a_missing_or_unowned_occurrence(self):
        response = self.client.post(
            f"/api/tasks/{uuid.uuid4()}/commands/delete-occurrence/",
            {"occurrence_version": 1},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

        other_user, other_client = auth_client("delete-occ-other@example.com")
        other_task = Task.objects.create(
            id=uuid.uuid4(), user=other_user, title="not yours",
            scope_kind="day", scope_value="2026-07-16",
        )
        response = self.delete_occurrence(other_task)
        self.assertEqual(response.status_code, 404)
        self.assertTrue(Task.objects.filter(id=other_task.id).exists())
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks.tests.TaskCommandApiTests -v 2` from `backend/`.
Expected: every `test_delete_occurrence_*` test fails (404 route not found).

- [ ] **Step 3: Implement `delete_occurrence` in `services.py`**

Add after `detach_task`:

```python
@dataclass(frozen=True)
class DeleteOccurrenceResult:
    removed_task_id: str
    anchor: Task | None


@transaction.atomic
def delete_occurrence(
    *,
    user,
    occurrence_id,
    occurrence_version: int,
) -> DeleteOccurrenceResult:
    _lock_user(user)
    occurrence_key = str(occurrence_id)
    tasks = _locked_owned_tasks(user, [occurrence_id])
    if occurrence_key not in tasks:
        raise TaskCommandNotFound

    occurrence = tasks[occurrence_key]
    _assert_versions({occurrence_key: occurrence_version}, tasks)

    anchor = _append_anchor_exclusion(user, occurrence)
    removed_task_id = str(occurrence.id)
    occurrence.delete()

    return DeleteOccurrenceResult(removed_task_id=removed_task_id, anchor=anchor)
```

- [ ] **Step 4: Add `DeleteOccurrenceCommandSerializer` to `serializers.py`**

```python
class DeleteOccurrenceCommandSerializer(serializers.Serializer):
    occurrence_version = serializers.IntegerField(min_value=1)
```

- [ ] **Step 5: Add `DeleteOccurrenceCommandView` to `views.py` and register the URL**

Update the `serializers`/`services` imports in `views.py` to include `DeleteOccurrenceCommandSerializer` and `delete_occurrence`. Add the view after `DetachTaskCommandView`:

```python
class DeleteOccurrenceCommandView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request, pk):
        serializer = DeleteOccurrenceCommandSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            result = delete_occurrence(
                user=request.user,
                occurrence_id=pk,
                occurrence_version=data["occurrence_version"],
            )
        except TaskCommandNotFound as exc:
            raise NotFound from exc
        except TaskVersionConflict as exc:
            raise TaskVersionConflictResponse(exc.current_versions) from exc
        except TaskCommandConflict as exc:
            raise TaskCommandConflictResponse(exc) from exc

        body = {"removed_task_id": result.removed_task_id}
        if result.anchor is not None:
            body["anchor"] = TaskSerializer(result.anchor, context={"request": request}).data
        return Response(body, status=status.HTTP_200_OK)
```

In `backend/config/urls.py`, import `DeleteOccurrenceCommandView` and register:

```python
    path(
        "api/tasks/<uuid:pk>/commands/delete-occurrence/",
        DeleteOccurrenceCommandView.as_view(),
        name="task-command-delete-occurrence",
    ),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks.tests.TaskCommandApiTests -v 2` from `backend/`.
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/tasks/services.py backend/apps/tasks/serializers.py backend/apps/tasks/views.py backend/config/urls.py backend/apps/tasks/tests.py
git commit -m "feat: add the Delete-occurrence command (RF-005 phase 1)"
```

---

## Task 3: Backend — Reschedule command

**Files:**
- Modify: `backend/apps/tasks/services.py`
- Modify: `backend/apps/tasks/serializers.py`
- Modify: `backend/apps/tasks/views.py`
- Modify: `backend/config/urls.py`
- Test: `backend/apps/tasks/tests.py`

**Interfaces:**
- Consumes: `_lock_user`, `_locked_owned_tasks`, `_assert_versions`, `_current_effective_date`, `_append_anchor_exclusion` (Task 1).
- Produces: `reschedule_task(*, user, task_id, task_version: int, date: str) -> RescheduleTaskResult` where `RescheduleTaskResult` has `task: Task`, `anchor: Task | None`. Domain conflict codes: `not_reschedulable`, `same_date`.

- [ ] **Step 1: Write the failing tests**

Add to `TaskCommandApiTests` in `backend/apps/tasks/tests.py`:

```python
    def reschedule(self, task, date, **overrides):
        payload = {"task_version": task.version, "date": date}
        payload.update(overrides)
        return self.client.post(
            f"/api/tasks/{task.id}/commands/reschedule/",
            payload,
            format="json",
        )

    def test_reschedule_moves_a_day_scoped_task_and_clears_repeat_source(self):
        anchor = self.create_task(
            title="gym", scope_value="2026-07-01", repeat_weekdays=[4],
        )
        occurrence = self.create_task(
            title="gym", scope_value="2026-07-16", repeat_source=str(anchor.id),
        )

        response = self.reschedule(occurrence, "2026-07-20")

        self.assertEqual(response.status_code, 200, response.data)
        occurrence.refresh_from_db()
        self.assertEqual(occurrence.scope_kind, "day")
        self.assertEqual(occurrence.scope_value, "2026-07-20")
        self.assertIsNone(occurrence.repeat_source_id)
        anchor.refresh_from_db()
        self.assertEqual(anchor.excluded_dates, ["2026-07-16"])

    def test_reschedule_moves_a_rolled_over_week_scoped_task_clearing_rolled_from(self):
        task = self.create_task(title="overdue thing", scope_kind="week")
        task.scope_kind = "week"
        task.scope_value = "2026-07-13"
        task.rolled_from_kind = "day"
        task.rolled_from_value = "2026-07-10"
        task.save(update_fields=["scope_kind", "scope_value", "rolled_from_kind", "rolled_from_value"])

        response = self.reschedule(task, "2026-07-20")

        self.assertEqual(response.status_code, 200, response.data)
        task.refresh_from_db()
        self.assertEqual(task.scope_kind, "day")
        self.assertEqual(task.scope_value, "2026-07-20")
        self.assertIsNone(task.rolled_from_kind)
        self.assertIsNone(task.rolled_from_value)

    def test_reschedule_appends_order_past_the_destinations_untimed_tasks(self):
        existing = self.create_task(title="already there", scope_value="2026-07-20", order=3)
        task = self.create_task(title="moving in", scope_value="2026-07-16")

        self.reschedule(task, "2026-07-20")

        task.refresh_from_db()
        self.assertEqual(task.order, 4.0)

    def test_reschedule_leaves_a_timed_tasks_order_untouched(self):
        task = self.create_task(title="timed", scope_value="2026-07-16", time="09:00", order=7)

        self.reschedule(task, "2026-07-20")

        task.refresh_from_db()
        self.assertEqual(task.order, 7)

    def test_reschedule_rejects_the_same_effective_date_as_a_conflict(self):
        task = self.create_task(title="staying put", scope_value="2026-07-16")

        response = self.reschedule(task, "2026-07-16")

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "same_date")

    def test_reschedule_rejects_a_month_scoped_task_as_not_reschedulable(self):
        task = self.create_task(title="goal", scope_kind="month", scope_value="2026-07")

        response = self.reschedule(task, "2026-07-20")

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "not_reschedulable")

    def test_reschedule_returns_409_for_a_stale_version(self):
        task = self.create_task(title="solo", scope_value="2026-07-16")

        response = self.reschedule(task, "2026-07-20", task_version=task.version + 1)

        self.assertEqual(response.status_code, 409, response.data)

    def test_reschedule_returns_404_for_a_missing_or_unowned_task(self):
        response = self.client.post(
            f"/api/tasks/{uuid.uuid4()}/commands/reschedule/",
            {"task_version": 1, "date": "2026-07-20"},
            format="json",
        )
        self.assertEqual(response.status_code, 404)
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks.tests.TaskCommandApiTests -v 2` from `backend/`.
Expected: every `test_reschedule_*` test fails (404 route not found).

- [ ] **Step 3: Implement `reschedule_task` in `services.py`**

Add after `delete_occurrence`, with `Q` already imported at the top of the file:

```python
@dataclass(frozen=True)
class RescheduleTaskResult:
    task: Task
    anchor: Task | None


@transaction.atomic
def reschedule_task(
    *,
    user,
    task_id,
    task_version: int,
    date: str,
) -> RescheduleTaskResult:
    _lock_user(user)
    task_key = str(task_id)
    tasks = _locked_owned_tasks(user, [task_id])
    if task_key not in tasks:
        raise TaskCommandNotFound

    task = tasks[task_key]
    _assert_versions({task_key: task_version}, tasks)

    current_date = _current_effective_date(task)
    if current_date is None:
        raise TaskCommandConflict(
            "not_reschedulable",
            "Only a day-scoped task or a rolled-over week-scoped task can be rescheduled.",
        )
    if current_date == date:
        raise TaskCommandConflict("same_date", "The task is already scheduled on this date.")

    # Must run before repeat_source is cleared below.
    anchor = _append_anchor_exclusion(user, task)

    if not task.time:
        # Mirrors the frontend's current dayTasksForWeek-based scan: counts
        # both day-scoped tasks already on the destination date and
        # week-scoped tasks rolled over from it, including done tasks
        # (position, not completion, drives this list). rolled_from_value
        # alone pins the week — a calendar date belongs to exactly one
        # week, so the frontend's extra weekStart match is redundant, not a
        # distinct filter.
        siblings = list(
            Task.objects.select_for_update()
            .filter(user=user)
            .filter(
                Q(scope_kind="day", scope_value=date)
                | Q(scope_kind="week", rolled_from_kind="day", rolled_from_value=date)
            )
            .filter(Q(time__isnull=True) | Q(time=""))
        )
        task.order = max([0.0, *(sibling.order for sibling in siblings)]) + 1.0

    task.scope_kind = "day"
    task.scope_value = date
    task.rolled_from_kind = None
    task.rolled_from_value = None
    task.repeat_source = None
    task.version += 1
    task.save(
        update_fields=[
            "scope_kind", "scope_value", "rolled_from_kind", "rolled_from_value",
            "repeat_source", "order", "version", "updated_at",
        ]
    )

    return RescheduleTaskResult(task=task, anchor=anchor)
```

- [ ] **Step 4: Add `RescheduleTaskCommandSerializer` to `serializers.py`**

```python
class RescheduleTaskCommandSerializer(serializers.Serializer):
    task_version = serializers.IntegerField(min_value=1)
    date = serializers.CharField(max_length=10)
```

Format validation for `date` (must be `YYYY-MM-DD`) is intentionally left to the service/model layer's existing conventions rather than duplicated here — `reschedule_task` writes it straight into `scope_value`, which round-trips through the same `TaskSerializer` validation on the next read. If this feels thin during review, compare against how `NestTaskCommandSerializer` also leaves `subtask_id` format unchecked and relies on the service layer's own domain checks.

- [ ] **Step 5: Add `RescheduleTaskCommandView` to `views.py` and register the URL**

Update `views.py`'s `serializers`/`services` imports to include `RescheduleTaskCommandSerializer` and `reschedule_task`. Add the view after `DeleteOccurrenceCommandView`:

```python
class RescheduleTaskCommandView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request, pk):
        serializer = RescheduleTaskCommandSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            result = reschedule_task(
                user=request.user,
                task_id=pk,
                task_version=data["task_version"],
                date=data["date"],
            )
        except TaskCommandNotFound as exc:
            raise NotFound from exc
        except TaskVersionConflict as exc:
            raise TaskVersionConflictResponse(exc.current_versions) from exc
        except TaskCommandConflict as exc:
            raise TaskCommandConflictResponse(exc) from exc

        body = {"task": TaskSerializer(result.task, context={"request": request}).data}
        if result.anchor is not None:
            body["anchor"] = TaskSerializer(result.anchor, context={"request": request}).data
        return Response(body, status=status.HTTP_200_OK)
```

In `backend/config/urls.py`, import `RescheduleTaskCommandView` and register:

```python
    path(
        "api/tasks/<uuid:pk>/commands/reschedule/",
        RescheduleTaskCommandView.as_view(),
        name="task-command-reschedule",
    ),
```

- [ ] **Step 6: Run the full backend test suite**

Run: `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks -v 2` from `backend/`.
Expected: PASS, all tests including the pre-existing 117 from before this plan.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/tasks/services.py backend/apps/tasks/serializers.py backend/apps/tasks/views.py backend/config/urls.py backend/apps/tasks/tests.py
git commit -m "feat: add the Reschedule command (RF-005 phase 1)"
```

---

## Task 4: Frontend — Detach command wiring

**Files:**
- Modify: `frontend/src/features/tasks/data/repository.ts`
- Modify: `frontend/src/features/tasks/data/api-task-repository.ts`
- Modify: `frontend/src/features/tasks/api/tasks.ts`
- Create: `frontend/src/app/api/tasks/[id]/commands/detach/route.ts`
- Modify: `frontend/src/features/tasks/test-utils.tsx`
- Modify: `frontend/src/features/tasks/store.tsx`
- Test: `frontend/src/features/tasks/data/repository.test.ts`, `frontend/src/features/tasks/store.test.tsx`

**Interfaces:**
- Consumes (backend, Task 1): `POST /api/tasks/{id}/commands/detach/` → `{ occurrence: ApiTask, anchor?: ApiTask }`.
- Produces: `TaskRepository.detachTask(command: DetachTaskCommand): Promise<DetachTaskResult>` where `DetachTaskCommand = { occurrenceId: string; occurrenceVersion: number; repeatWeekdays?: number[] }` and `DetachTaskResult = { occurrence: Task; anchor?: Task }`. Reused by Task 5/6's equivalent shapes (`DeleteOccurrenceCommand`/`Result`, `RescheduleTaskCommand`/`Result`) — keep the naming pattern (`<verb>Task`/`<Verb>Command`/`<Verb>Result`) consistent so those tasks' code matches what's here.

- [ ] **Step 1: Add types and the `TaskRepository` interface method in `repository.ts`**

In `frontend/src/features/tasks/data/repository.ts`, add after the existing `PromoteSubtaskResult` interface:

```typescript
export interface DetachTaskCommand {
  occurrenceId: string;
  occurrenceVersion: number;
  repeatWeekdays?: number[];
}

export interface DetachTaskResult {
  occurrence: Task;
  anchor?: Task;
}
```

Add to the `TaskRepository` interface:

```typescript
  detachTask(command: DetachTaskCommand): Promise<DetachTaskResult>;
```

- [ ] **Step 2: Write the failing `createLocalStorageRepository` test**

Add to `frontend/src/features/tasks/data/repository.test.ts` (read the file first to match its existing `describe`/`it` structure and imports — it already tests `nestTask`/`promoteSubtask` on `createLocalStorageRepository`, follow that exact pattern):

```typescript
  it("detachTask clears repeatSourceId and excludes the date on the anchor", async () => {
    const repo = createLocalStorageRepository(storage);
    const anchor = makeTask({
      id: "anchor",
      scope: { kind: "day", date: "2026-07-01" },
      repeatWeekdays: [4],
    });
    const occurrence = makeTask({
      id: "occ",
      scope: { kind: "day", date: "2026-07-16" },
      repeatSourceId: "anchor",
    });
    storage.setItem(STORAGE_KEY, JSON.stringify([anchor, occurrence]));

    const result = await repo.detachTask({
      occurrenceId: "occ",
      occurrenceVersion: 1,
    });

    expect(result.occurrence.repeatSourceId).toBeUndefined();
    expect(result.anchor?.excludedDates).toEqual(["2026-07-16"]);
  });

  it("detachTask throws TaskVersionConflictError on a stale version", async () => {
    const repo = createLocalStorageRepository(storage);
    const occurrence = makeTask({ id: "occ" });
    storage.setItem(STORAGE_KEY, JSON.stringify([occurrence]));

    await expect(
      repo.detachTask({ occurrenceId: "occ", occurrenceVersion: 99 }),
    ).rejects.toThrow(TaskVersionConflictError);
  });
```

If `makeTask`/`storage` aren't already in scope in this file the way they're used above, match whatever helper names the existing `nestTask` tests in the same file actually use instead — read the file before writing this step for real, don't guess the fixture names.

- [ ] **Step 3: Run the test to confirm it fails**

Run: `npx vitest run src/features/tasks/data/repository.test.ts` from `frontend/`.
Expected: FAIL — `repo.detachTask is not a function`.

- [ ] **Step 4: Implement `detachTask` in `createLocalStorageRepository`**

In `frontend/src/features/tasks/data/repository.ts`, add to the object returned by `createLocalStorageRepository`, after `promoteSubtask`:

```typescript
    async detachTask(command) {
      const tasks = read();
      const occurrence = tasks.find((t) => t.id === command.occurrenceId);
      if (!occurrence || occurrence.version !== command.occurrenceVersion) {
        throw new TaskVersionConflictError();
      }
      const updatedOccurrence: Task = {
        ...occurrence,
        version: occurrence.version + 1,
        repeatSourceId: undefined,
        repeatWeekdays:
          command.repeatWeekdays && command.repeatWeekdays.length > 0
            ? command.repeatWeekdays
            : undefined,
      };
      let updatedAnchor: Task | undefined;
      const anchorId = occurrence.repeatSourceId;
      if (anchorId) {
        const anchor = tasks.find((t) => t.id === anchorId);
        if (anchor) {
          const date = occurrence.scope.kind === "day" ? occurrence.scope.date : undefined;
          const existing = new Set(anchor.excludedDates ?? []);
          updatedAnchor =
            date && !existing.has(date)
              ? { ...anchor, version: anchor.version + 1, excludedDates: [...(anchor.excludedDates ?? []), date] }
              : anchor;
        }
      }
      write(
        tasks.map((t) => {
          if (t.id === updatedOccurrence.id) return updatedOccurrence;
          if (updatedAnchor && t.id === updatedAnchor.id) return updatedAnchor;
          return t;
        }),
      );
      return updatedAnchor
        ? { occurrence: updatedOccurrence, anchor: updatedAnchor }
        : { occurrence: updatedOccurrence };
    },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/features/tasks/data/repository.test.ts` from `frontend/`.
Expected: PASS.

- [ ] **Step 6: Add the API repository implementation**

In `frontend/src/features/tasks/data/api-task-repository.ts`, add to the object returned by `createApiTaskRepository`, after `promoteSubtask`, following the exact `taskFetch`/`guardTaskMutation` pattern `nestTask` already uses:

```typescript
    async detachTask(command) {
      const response = await taskFetch(`/api/tasks/${command.occurrenceId}/commands/detach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      await guardTaskMutation(response, redirectToLogin);
      return (await response.json()) as DetachTaskResult;
    },
```

Add `DetachTaskResult` to this file's import from `./repository` (alongside the existing `NestTaskResult`/`PromoteSubtaskResult` import).

- [ ] **Step 7: Add the BFF request function**

In `frontend/src/features/tasks/api/tasks.ts`, add after `requestPromoteSubtask`, following the exact shape `requestNestTask` uses:

```typescript
export interface DetachTaskRequest {
  occurrenceVersion: number;
  repeatWeekdays?: number[];
}

export interface DetachTaskResponse {
  occurrence: Task;
  anchor?: Task;
  status: number;
}

export async function requestDetachTask(
  occurrenceId: string,
  command: DetachTaskRequest,
): Promise<DetachTaskResponse> {
  const response = await taskMutationRequest(`/api/tasks/${occurrenceId}/commands/detach/`, {
    method: "POST",
    body: JSON.stringify({
      occurrence_version: command.occurrenceVersion,
      repeat_weekdays: command.repeatWeekdays ?? null,
    }),
  });
  const payload = (await response.json()) as { occurrence: ApiTask; anchor?: ApiTask };
  return {
    occurrence: fromApiPayload(payload.occurrence),
    anchor: payload.anchor ? fromApiPayload(payload.anchor) : undefined,
    status: response.status,
  };
}
```

- [ ] **Step 8: Add the Next.js BFF route**

Create `frontend/src/app/api/tasks/[id]/commands/detach/route.ts`, following the exact shape of the sibling `nest/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server";

import { TaskApiError, requestDetachTask, type DetachTaskRequest } from "@/features/tasks/api/tasks";
import { ApiUnauthorizedError } from "@/lib/api/server";
import { unauthorizedResponse } from "@/lib/auth/cookies";

function parseDetachCommand(body: unknown): DetachTaskRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.occurrenceVersion !== "number") return null;
  if (
    candidate.repeatWeekdays !== undefined &&
    !(Array.isArray(candidate.repeatWeekdays) && candidate.repeatWeekdays.every((d) => typeof d === "number"))
  ) {
    return null;
  }
  return {
    occurrenceVersion: candidate.occurrenceVersion,
    repeatWeekdays: candidate.repeatWeekdays as number[] | undefined,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const command = parseDetachCommand(await request.json());
    if (command === null) {
      return NextResponse.json(
        { error: "occurrenceVersion (number) is required; repeatWeekdays, if present, must be number[]." },
        { status: 400 },
      );
    }
    const result = await requestDetachTask(id, command);
    return NextResponse.json(
      { occurrence: result.occurrence, anchor: result.anchor },
      { status: result.status },
    );
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    if (error instanceof TaskApiError) {
      return NextResponse.json(error.body ?? { error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to detach task." },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 9: Add the fake repository implementation**

In `frontend/src/features/tasks/test-utils.tsx`, add to the object returned by `fakeRepository`, after `promoteSubtask` (same logic as the localStorage implementation in Step 4, operating on `state.tasks` instead of `read()`/`write()`):

```typescript
    async detachTask(command) {
      const occurrence = state.tasks.find((t) => t.id === command.occurrenceId);
      if (!occurrence || occurrence.version !== command.occurrenceVersion) {
        throw new TaskVersionConflictError();
      }
      const updatedOccurrence: Task = {
        ...occurrence,
        version: occurrence.version + 1,
        repeatSourceId: undefined,
        repeatWeekdays:
          command.repeatWeekdays && command.repeatWeekdays.length > 0
            ? command.repeatWeekdays
            : undefined,
      };
      let updatedAnchor: Task | undefined;
      const anchorId = occurrence.repeatSourceId;
      if (anchorId) {
        const anchor = state.tasks.find((t) => t.id === anchorId);
        if (anchor) {
          const date = occurrence.scope.kind === "day" ? occurrence.scope.date : undefined;
          const existing = new Set(anchor.excludedDates ?? []);
          updatedAnchor =
            date && !existing.has(date)
              ? { ...anchor, version: anchor.version + 1, excludedDates: [...(anchor.excludedDates ?? []), date] }
              : anchor;
        }
      }
      state.tasks = state.tasks.map((t) => {
        if (t.id === updatedOccurrence.id) return updatedOccurrence;
        if (updatedAnchor && t.id === updatedAnchor.id) return updatedAnchor;
        return t;
      });
      return updatedAnchor
        ? { occurrence: updatedOccurrence, anchor: updatedAnchor }
        : { occurrence: updatedOccurrence };
    },
```

- [ ] **Step 10: Write the failing store test**

Add to `frontend/src/features/tasks/store.test.tsx`, near the existing `detachFromRoutine` tests (read that describe block first — this replaces the assertions that depended on two separate `persistUpdate` calls, since the store now issues one command):

```typescript
    it("detachFromRoutine calls repo.detachTask once and applies both the occurrence and anchor from the response", async () => {
      const anchor = makeTask({ id: "anchor", scope: { kind: "day", date: "2026-07-01" }, repeatWeekdays: [4] });
      const occurrence = makeTask({
        id: "occ",
        scope: { kind: "day", date: "2026-07-16" },
        repeatSourceId: "anchor",
      });
      const { repo, result } = setup(fakeRepository([anchor, occurrence]));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      const detachSpy = vi.spyOn(repo, "detachTask");

      act(() => result.current.detachFromRoutine("occ"));

      await waitFor(() => expect(detachSpy).toHaveBeenCalledTimes(1));
      expect(detachSpy).toHaveBeenCalledWith({
        occurrenceId: "occ",
        occurrenceVersion: 1,
        repeatWeekdays: undefined,
      });
      await waitFor(() =>
        expect(result.current.tasks.find((t) => t.id === "anchor")?.excludedDates).toEqual(["2026-07-16"]),
      );
    });
```

Existing tests in that same describe block ("detachFromRoutine clears repeatSourceId...", "...sets repeatWeekdays when weekdays are provided", "...records the occurrence's date...", "...appends to existing excludedDates...", "detaching a task that was already standalone...", "detaching today's occurrence, then reloading...") assert on `result.current.tasks`/`repo.tasks` shape and should keep passing unchanged against the new implementation — they test the *outcome*, not the two-`persistUpdate`-calls mechanism, so leave them as-is and only add the new spy-based test above. If any of them fail after Step 11 below, that's a real regression to fix, not a test to delete.

- [ ] **Step 11: Run the test to confirm it fails**

Run: `npx vitest run src/features/tasks/store.test.tsx -t detachFromRoutine` from `frontend/`.
Expected: FAIL — `repo.detachTask` was never called (current implementation still calls `persistUpdate` twice, not the new command).

- [ ] **Step 12: Rewrite `detachFromRoutine` in `store.tsx`**

In `frontend/src/features/tasks/store.tsx`, replace the existing `detachFromRoutine` implementation (currently at approximately line 593) with:

```typescript
      detachFromRoutine(id, weekdays) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current) return;
        const normalized = weekdays && weekdays.length > 0 ? weekdays : undefined;
        const wasOccurrence = current.repeatSourceId !== undefined;
        const anchorId = current.repeatSourceId;

        const updatedOccurrence: Task = {
          ...current,
          repeatSourceId: undefined,
          repeatWeekdays: normalized,
        };
        const occurrenceGeneration = nextMutationGeneration(current.id);
        const anchorGeneration = anchorId ? nextMutationGeneration(anchorId) : undefined;
        applyCommandState([updatedOccurrence], []);

        enqueueMutation(async () => {
          const result = await repo.detachTask({
            occurrenceId: current.id,
            occurrenceVersion: authoritativeVersionsRef.current.get(current.id) ?? current.version,
            repeatWeekdays: normalized,
          });
          authoritativeVersionsRef.current.set(result.occurrence.id, result.occurrence.version);
          authoritativeTasksRef.current.set(result.occurrence.id, result.occurrence);

          const currentOccurrence = tasksRef.current.find((t) => t.id === result.occurrence.id);
          const reconciledOccurrence =
            currentOccurrence &&
            mutationGenerationsRef.current.get(result.occurrence.id) !== occurrenceGeneration
              ? { ...currentOccurrence, version: result.occurrence.version }
              : result.occurrence;

          const upserts = [reconciledOccurrence];
          if (result.anchor) {
            authoritativeVersionsRef.current.set(result.anchor.id, result.anchor.version);
            authoritativeTasksRef.current.set(result.anchor.id, result.anchor);
            const currentAnchor = tasksRef.current.find((t) => t.id === result.anchor!.id);
            const reconciledAnchor =
              currentAnchor && anchorGeneration !== undefined &&
              mutationGenerationsRef.current.get(result.anchor.id) !== anchorGeneration
                ? { ...currentAnchor, version: result.anchor.version }
                : result.anchor;
            upserts.push(reconciledAnchor);
          }
          applyCommandState(upserts, []);
        });

        void wasOccurrence; // documents intent; the command itself is a no-op server-side when there's no anchor
      },
```

Note the reconciliation for the anchor's optimistic state: unlike `convertTaskToSubtask`'s target (which the store already updated with a real subtask list at enqueue time), this task's optimistic `applyCommandState([updatedOccurrence], [])` call does **not** speculatively update the anchor's `excludedDates` — the anchor stays as its current authoritative value until the command resolves, then gets applied from the response. This is a deliberate simplification versus a fully optimistic anchor update: attempting to also optimistically union the date into the anchor here would duplicate `buildTaskPatch`'s existing `excludedDatesAdded` delta logic outside the normal `persistUpdate` path for no test-covered benefit, since the round-trip to the server for this specific command is not on any hot interactive path (unlike typing in a text field). If a later review wants a fully optimistic anchor update, it is a follow-up, not a blocker for this task's test (Step 10 asserts against `result.current.tasks` after `waitFor`, i.e. post-resolution state, not the synchronous optimistic frame).

- [ ] **Step 13: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/store.test.tsx -t detachFromRoutine` from `frontend/`.
Expected: PASS, both the new test and all pre-existing `detachFromRoutine` tests in that block.

- [ ] **Step 14: Run the full frontend suite for regressions**

Run: `npx vitest run` from `frontend/`.
Expected: no new failures beyond whatever was already failing before this task started (check `git stash` + rerun if unsure whether a failure is pre-existing).

- [ ] **Step 15: Commit**

```bash
git add frontend/src/features/tasks/data/repository.ts frontend/src/features/tasks/data/repository.test.ts frontend/src/features/tasks/data/api-task-repository.ts frontend/src/features/tasks/api/tasks.ts frontend/src/app/api/tasks/[id]/commands/detach/route.ts frontend/src/features/tasks/test-utils.tsx frontend/src/features/tasks/store.tsx frontend/src/features/tasks/store.test.tsx
git commit -m "feat: wire the Detach command into the frontend (RF-005 phase 1)"
```

---

## Task 5: Frontend — Delete-occurrence command wiring

**Files:** same shape as Task 4, for `removeTask` instead of `detachFromRoutine`.
- Modify: `frontend/src/features/tasks/data/repository.ts`
- Modify: `frontend/src/features/tasks/data/api-task-repository.ts`
- Modify: `frontend/src/features/tasks/api/tasks.ts`
- Create: `frontend/src/app/api/tasks/[id]/commands/delete-occurrence/route.ts`
- Modify: `frontend/src/features/tasks/test-utils.tsx`
- Modify: `frontend/src/features/tasks/store.tsx`
- Test: `frontend/src/features/tasks/data/repository.test.ts`, `frontend/src/features/tasks/store.test.tsx`

**Interfaces:**
- Consumes (backend, Task 2): `POST /api/tasks/{id}/commands/delete-occurrence/` → `{ removed_task_id: string, anchor?: ApiTask }`.
- Produces: `TaskRepository.deleteOccurrence(command: DeleteOccurrenceCommand): Promise<DeleteOccurrenceResult>` where `DeleteOccurrenceCommand = { occurrenceId: string; occurrenceVersion: number }` and `DeleteOccurrenceResult = { removedTaskId: string; anchor?: Task }`.

- [ ] **Step 1: Add types and the `TaskRepository` interface method in `repository.ts`**

```typescript
export interface DeleteOccurrenceCommand {
  occurrenceId: string;
  occurrenceVersion: number;
}

export interface DeleteOccurrenceResult {
  removedTaskId: string;
  anchor?: Task;
}
```

Add `deleteOccurrence(command: DeleteOccurrenceCommand): Promise<DeleteOccurrenceResult>;` to the `TaskRepository` interface.

- [ ] **Step 2: Write the failing `createLocalStorageRepository` test**

Add to `frontend/src/features/tasks/data/repository.test.ts`:

```typescript
  it("deleteOccurrence removes the task and excludes its date on the anchor", async () => {
    const repo = createLocalStorageRepository(storage);
    const anchor = makeTask({
      id: "anchor",
      scope: { kind: "day", date: "2026-07-01" },
      repeatWeekdays: [4],
    });
    const occurrence = makeTask({
      id: "occ",
      scope: { kind: "day", date: "2026-07-16" },
      repeatSourceId: "anchor",
    });
    storage.setItem(STORAGE_KEY, JSON.stringify([anchor, occurrence]));

    const result = await repo.deleteOccurrence({ occurrenceId: "occ", occurrenceVersion: 1 });

    expect(result.removedTaskId).toBe("occ");
    expect(result.anchor?.excludedDates).toEqual(["2026-07-16"]);
    const remaining = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]") as Task[];
    expect(remaining.find((t) => t.id === "occ")).toBeUndefined();
  });
```

- [ ] **Step 3: Run the test to confirm it fails**

Run: `npx vitest run src/features/tasks/data/repository.test.ts` from `frontend/`.
Expected: FAIL — `repo.deleteOccurrence is not a function`.

- [ ] **Step 4: Implement `deleteOccurrence` in `createLocalStorageRepository`**

```typescript
    async deleteOccurrence(command) {
      const tasks = read();
      const occurrence = tasks.find((t) => t.id === command.occurrenceId);
      if (!occurrence || occurrence.version !== command.occurrenceVersion) {
        throw new TaskVersionConflictError();
      }
      let updatedAnchor: Task | undefined;
      const anchorId = occurrence.repeatSourceId;
      if (anchorId) {
        const anchor = tasks.find((t) => t.id === anchorId);
        if (anchor) {
          const date = occurrence.scope.kind === "day" ? occurrence.scope.date : undefined;
          const existing = new Set(anchor.excludedDates ?? []);
          updatedAnchor =
            date && !existing.has(date)
              ? { ...anchor, version: anchor.version + 1, excludedDates: [...(anchor.excludedDates ?? []), date] }
              : anchor;
        }
      }
      write(
        tasks
          .filter((t) => t.id !== occurrence.id)
          .map((t) => (updatedAnchor && t.id === updatedAnchor.id ? updatedAnchor : t)),
      );
      return updatedAnchor
        ? { removedTaskId: occurrence.id, anchor: updatedAnchor }
        : { removedTaskId: occurrence.id };
    },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/features/tasks/data/repository.test.ts` from `frontend/`.
Expected: PASS.

- [ ] **Step 6: Add the API repository implementation**

In `api-task-repository.ts`, add `DeleteOccurrenceResult` to the `./repository` import, then add:

```typescript
    async deleteOccurrence(command) {
      const response = await taskFetch(
        `/api/tasks/${command.occurrenceId}/commands/delete-occurrence`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(command),
        },
      );
      await guardTaskMutation(response, redirectToLogin);
      return (await response.json()) as DeleteOccurrenceResult;
    },
```

- [ ] **Step 7: Add the BFF request function**

In `frontend/src/features/tasks/api/tasks.ts`, add:

```typescript
export interface DeleteOccurrenceRequest {
  occurrenceVersion: number;
}

export interface DeleteOccurrenceResponse {
  removedTaskId: string;
  anchor?: Task;
  status: number;
}

export async function requestDeleteOccurrence(
  occurrenceId: string,
  command: DeleteOccurrenceRequest,
): Promise<DeleteOccurrenceResponse> {
  const response = await taskMutationRequest(
    `/api/tasks/${occurrenceId}/commands/delete-occurrence/`,
    {
      method: "POST",
      body: JSON.stringify({ occurrence_version: command.occurrenceVersion }),
    },
  );
  const payload = (await response.json()) as { removed_task_id: string; anchor?: ApiTask };
  return {
    removedTaskId: payload.removed_task_id,
    anchor: payload.anchor ? fromApiPayload(payload.anchor) : undefined,
    status: response.status,
  };
}
```

- [ ] **Step 8: Add the Next.js BFF route**

Create `frontend/src/app/api/tasks/[id]/commands/delete-occurrence/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server";

import {
  TaskApiError,
  requestDeleteOccurrence,
  type DeleteOccurrenceRequest,
} from "@/features/tasks/api/tasks";
import { ApiUnauthorizedError } from "@/lib/api/server";
import { unauthorizedResponse } from "@/lib/auth/cookies";

function parseDeleteOccurrenceCommand(body: unknown): DeleteOccurrenceRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.occurrenceVersion !== "number") return null;
  return { occurrenceVersion: candidate.occurrenceVersion };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const command = parseDeleteOccurrenceCommand(await request.json());
    if (command === null) {
      return NextResponse.json(
        { error: "occurrenceVersion (number) is required." },
        { status: 400 },
      );
    }
    const result = await requestDeleteOccurrence(id, command);
    return NextResponse.json(
      { removedTaskId: result.removedTaskId, anchor: result.anchor },
      { status: result.status },
    );
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    if (error instanceof TaskApiError) {
      return NextResponse.json(error.body ?? { error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete occurrence." },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 9: Add the fake repository implementation**

In `test-utils.tsx`, add (same logic as Step 4, over `state.tasks`):

```typescript
    async deleteOccurrence(command) {
      const occurrence = state.tasks.find((t) => t.id === command.occurrenceId);
      if (!occurrence || occurrence.version !== command.occurrenceVersion) {
        throw new TaskVersionConflictError();
      }
      let updatedAnchor: Task | undefined;
      const anchorId = occurrence.repeatSourceId;
      if (anchorId) {
        const anchor = state.tasks.find((t) => t.id === anchorId);
        if (anchor) {
          const date = occurrence.scope.kind === "day" ? occurrence.scope.date : undefined;
          const existing = new Set(anchor.excludedDates ?? []);
          updatedAnchor =
            date && !existing.has(date)
              ? { ...anchor, version: anchor.version + 1, excludedDates: [...(anchor.excludedDates ?? []), date] }
              : anchor;
        }
      }
      state.tasks = state.tasks
        .filter((t) => t.id !== occurrence.id)
        .map((t) => (updatedAnchor && t.id === updatedAnchor.id ? updatedAnchor : t));
      return updatedAnchor
        ? { removedTaskId: occurrence.id, anchor: updatedAnchor }
        : { removedTaskId: occurrence.id };
    },
```

- [ ] **Step 10: Write the failing store test**

Add to `frontend/src/features/tasks/store.test.tsx` near the existing `removeTask` tests:

```typescript
    it("removeTask calls repo.deleteOccurrence for a task with a repeat source, applying the anchor from the response", async () => {
      const anchor = makeTask({ id: "anchor", scope: { kind: "day", date: "2026-07-01" }, repeatWeekdays: [4] });
      const occurrence = makeTask({
        id: "occ",
        scope: { kind: "day", date: "2026-07-16" },
        repeatSourceId: "anchor",
      });
      const { repo, result } = setup(fakeRepository([anchor, occurrence]));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      const deleteSpy = vi.spyOn(repo, "deleteOccurrence");
      const removeSpy = vi.spyOn(repo, "remove");

      act(() => result.current.removeTask("occ"));

      await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith({ occurrenceId: "occ", occurrenceVersion: 1 }));
      expect(removeSpy).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(result.current.tasks.find((t) => t.id === "anchor")?.excludedDates).toEqual(["2026-07-16"]),
      );
      expect(result.current.tasks.find((t) => t.id === "occ")).toBeUndefined();
    });

    it("removeTask calls repo.remove (not deleteOccurrence) for a task with no repeat source", async () => {
      const task = makeTask({ id: "solo" });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      const deleteSpy = vi.spyOn(repo, "deleteOccurrence");

      act(() => result.current.removeTask("solo"));

      await waitFor(() => expect(result.current.tasks).toHaveLength(0));
      expect(deleteSpy).not.toHaveBeenCalled();
    });
```

The second test pins a deliberate implementation choice made in Step 11 below: `removeTask` only calls the new command when the task actually has a `repeatSourceId` to reconcile; a plain task still uses `repo.remove` (the existing generic delete), since there is no anchor write to make atomic and no reason to route a plain delete through a heavier command endpoint.

- [ ] **Step 11: Run the tests to confirm they fail**

Run: `npx vitest run src/features/tasks/store.test.tsx -t removeTask` from `frontend/`.
Expected: FAIL on the first new test (`deleteOccurrence` never called; current code always calls `repo.remove`).

- [ ] **Step 12: Rewrite `removeTask` in `store.tsx`**

Replace the existing `removeTask` implementation (currently at approximately line 887) with:

```typescript
      removeTask(id) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current) return;
        nextMutationGeneration(id);
        const anchorId = current.repeatSourceId;
        const anchorGeneration = anchorId ? nextMutationGeneration(anchorId) : undefined;
        removeTaskState(id);

        if (anchorId === undefined) {
          enqueueMutation(async () => {
            const version = authoritativeVersionsRef.current.get(id) ?? current.version;
            await repo.remove(id, version);
            authoritativeVersionsRef.current.delete(id);
            authoritativeTasksRef.current.delete(id);
          });
          return;
        }

        enqueueMutation(async () => {
          const result = await repo.deleteOccurrence({
            occurrenceId: id,
            occurrenceVersion: authoritativeVersionsRef.current.get(id) ?? current.version,
          });
          authoritativeVersionsRef.current.delete(result.removedTaskId);
          authoritativeTasksRef.current.delete(result.removedTaskId);

          if (result.anchor) {
            authoritativeVersionsRef.current.set(result.anchor.id, result.anchor.version);
            authoritativeTasksRef.current.set(result.anchor.id, result.anchor);
            const currentAnchor = tasksRef.current.find((t) => t.id === result.anchor!.id);
            const reconciledAnchor =
              currentAnchor && anchorGeneration !== undefined &&
              mutationGenerationsRef.current.get(result.anchor.id) !== anchorGeneration
                ? { ...currentAnchor, version: result.anchor.version }
                : result.anchor;
            applyCommandState([reconciledAnchor], [result.removedTaskId]);
          }
        });
      },
```

This removes the old second `persistUpdate(updatedAnchor)` call entirely (previously issued as a separate, non-atomic mutation right after `removeTaskState(id)`) — the anchor update is now folded into the same `deleteOccurrence` command and applied from its response.

- [ ] **Step 13: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/store.test.tsx -t removeTask` from `frontend/`.
Expected: PASS, both new tests and any pre-existing `removeTask` tests in the file.

- [ ] **Step 14: Run the full frontend suite for regressions**

Run: `npx vitest run` from `frontend/`.
Expected: no new failures.

- [ ] **Step 15: Commit**

```bash
git add frontend/src/features/tasks/data/repository.ts frontend/src/features/tasks/data/repository.test.ts frontend/src/features/tasks/data/api-task-repository.ts frontend/src/features/tasks/api/tasks.ts frontend/src/app/api/tasks/[id]/commands/delete-occurrence/route.ts frontend/src/features/tasks/test-utils.tsx frontend/src/features/tasks/store.tsx frontend/src/features/tasks/store.test.tsx
git commit -m "feat: wire the Delete-occurrence command into the frontend (RF-005 phase 1)"
```

---

## Task 6: Frontend — Reschedule command wiring

**Files:** same shape as Tasks 4/5, for `rescheduleTaskToDay`.
- Modify: `frontend/src/features/tasks/data/repository.ts`
- Modify: `frontend/src/features/tasks/data/api-task-repository.ts`
- Modify: `frontend/src/features/tasks/api/tasks.ts`
- Create: `frontend/src/app/api/tasks/[id]/commands/reschedule/route.ts`
- Modify: `frontend/src/features/tasks/test-utils.tsx`
- Modify: `frontend/src/features/tasks/store.tsx`
- Test: `frontend/src/features/tasks/data/repository.test.ts`, `frontend/src/features/tasks/store.test.tsx`

**Interfaces:**
- Consumes (backend, Task 3): `POST /api/tasks/{id}/commands/reschedule/` → `{ task: ApiTask, anchor?: ApiTask }`, `409` with `code: "same_date" | "not_reschedulable"`.
- Produces: `TaskRepository.rescheduleTask(command: RescheduleTaskCommand): Promise<RescheduleTaskResult>` where `RescheduleTaskCommand = { taskId: string; taskVersion: number; date: string }` and `RescheduleTaskResult = { task: Task; anchor?: Task }`.

- [ ] **Step 1: Add types and the `TaskRepository` interface method in `repository.ts`**

```typescript
export interface RescheduleTaskCommand {
  taskId: string;
  taskVersion: number;
  date: string;
}

export interface RescheduleTaskResult {
  task: Task;
  anchor?: Task;
}
```

Add `rescheduleTask(command: RescheduleTaskCommand): Promise<RescheduleTaskResult>;` to the `TaskRepository` interface.

- [ ] **Step 2: Write the failing `createLocalStorageRepository` tests**

Add to `frontend/src/features/tasks/data/repository.test.ts`:

```typescript
  it("rescheduleTask moves a day-scoped task and excludes the old date on its anchor", async () => {
    const repo = createLocalStorageRepository(storage);
    const anchor = makeTask({
      id: "anchor",
      scope: { kind: "day", date: "2026-07-01" },
      repeatWeekdays: [4],
    });
    const occurrence = makeTask({
      id: "occ",
      scope: { kind: "day", date: "2026-07-16" },
      repeatSourceId: "anchor",
    });
    storage.setItem(STORAGE_KEY, JSON.stringify([anchor, occurrence]));

    const result = await repo.rescheduleTask({ taskId: "occ", taskVersion: 1, date: "2026-07-20" });

    expect(result.task.scope).toEqual({ kind: "day", date: "2026-07-20" });
    expect(result.task.repeatSourceId).toBeUndefined();
    expect(result.anchor?.excludedDates).toEqual(["2026-07-16"]);
  });

  it("rescheduleTask rejects the same effective date", async () => {
    const repo = createLocalStorageRepository(storage);
    const task = makeTask({ id: "a", scope: { kind: "day", date: "2026-07-16" } });
    storage.setItem(STORAGE_KEY, JSON.stringify([task]));

    await expect(
      repo.rescheduleTask({ taskId: "a", taskVersion: 1, date: "2026-07-16" }),
    ).rejects.toThrow();
  });
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `npx vitest run src/features/tasks/data/repository.test.ts` from `frontend/`.
Expected: FAIL — `repo.rescheduleTask is not a function`.

- [ ] **Step 4: Implement `rescheduleTask` in `createLocalStorageRepository`**

```typescript
    async rescheduleTask(command) {
      const tasks = read();
      const task = tasks.find((t) => t.id === command.taskId);
      if (!task || task.version !== command.taskVersion) {
        throw new TaskVersionConflictError();
      }
      const currentDate =
        task.scope.kind === "day"
          ? task.scope.date
          : task.scope.kind === "week" && task.rolledFrom?.kind === "day"
            ? task.rolledFrom.date
            : undefined;
      if (currentDate === undefined) {
        throw new Error("Only a day-scoped or rolled-over week-scoped task can be rescheduled.");
      }
      if (currentDate === command.date) {
        throw new Error("The task is already scheduled on this date.");
      }

      let updatedAnchor: Task | undefined;
      const anchorId = task.repeatSourceId;
      if (anchorId) {
        const anchor = tasks.find((t) => t.id === anchorId);
        if (anchor) {
          const existing = new Set(anchor.excludedDates ?? []);
          updatedAnchor = existing.has(currentDate)
            ? anchor
            : { ...anchor, version: anchor.version + 1, excludedDates: [...(anchor.excludedDates ?? []), currentDate] };
        }
      }

      const order = task.time
        ? task.order
        : Math.max(
            0,
            ...dayTasksForWeek(tasks, command.date, weekStartOf(command.date))
              .filter((t) => !t.time)
              .map((t) => t.order),
          ) + 1;

      const updatedTask: Task = {
        ...task,
        version: task.version + 1,
        scope: { kind: "day", date: command.date },
        rolledFrom: undefined,
        repeatSourceId: undefined,
        order,
      };

      write(
        tasks.map((t) => {
          if (t.id === updatedTask.id) return updatedTask;
          if (updatedAnchor && t.id === updatedAnchor.id) return updatedAnchor;
          return t;
        }),
      );
      return updatedAnchor ? { task: updatedTask, anchor: updatedAnchor } : { task: updatedTask };
    },
```

Add `dayTasksForWeek` and `weekStartOf` to this file's imports from `../lib/times` (check that file's exports first — `weekStartOf` is used elsewhere in `store.tsx` already, confirm the exact import path matches).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/data/repository.test.ts` from `frontend/`.
Expected: PASS.

- [ ] **Step 6: Add the API repository implementation**

In `api-task-repository.ts`, add `RescheduleTaskResult` to the `./repository` import, then:

```typescript
    async rescheduleTask(command) {
      const response = await taskFetch(`/api/tasks/${command.taskId}/commands/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      await guardTaskMutation(response, redirectToLogin);
      return (await response.json()) as RescheduleTaskResult;
    },
```

- [ ] **Step 7: Add the BFF request function**

In `frontend/src/features/tasks/api/tasks.ts`:

```typescript
export interface RescheduleTaskRequest {
  taskVersion: number;
  date: string;
}

export interface RescheduleTaskResponse {
  task: Task;
  anchor?: Task;
  status: number;
}

export async function requestRescheduleTask(
  taskId: string,
  command: RescheduleTaskRequest,
): Promise<RescheduleTaskResponse> {
  const response = await taskMutationRequest(`/api/tasks/${taskId}/commands/reschedule/`, {
    method: "POST",
    body: JSON.stringify({ task_version: command.taskVersion, date: command.date }),
  });
  const payload = (await response.json()) as { task: ApiTask; anchor?: ApiTask };
  return {
    task: fromApiPayload(payload.task),
    anchor: payload.anchor ? fromApiPayload(payload.anchor) : undefined,
    status: response.status,
  };
}
```

- [ ] **Step 8: Add the Next.js BFF route**

Create `frontend/src/app/api/tasks/[id]/commands/reschedule/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server";

import {
  TaskApiError,
  requestRescheduleTask,
  type RescheduleTaskRequest,
} from "@/features/tasks/api/tasks";
import { ApiUnauthorizedError } from "@/lib/api/server";
import { unauthorizedResponse } from "@/lib/auth/cookies";

function parseRescheduleCommand(body: unknown): RescheduleTaskRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.taskVersion !== "number" || typeof candidate.date !== "string") return null;
  return { taskVersion: candidate.taskVersion, date: candidate.date };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const command = parseRescheduleCommand(await request.json());
    if (command === null) {
      return NextResponse.json(
        { error: "taskVersion (number) and date (string) are required." },
        { status: 400 },
      );
    }
    const result = await requestRescheduleTask(id, command);
    return NextResponse.json(
      { task: result.task, anchor: result.anchor },
      { status: result.status },
    );
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    if (error instanceof TaskApiError) {
      return NextResponse.json(error.body ?? { error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reschedule task." },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 9: Add the fake repository implementation**

In `test-utils.tsx`, add (same logic as Step 4, over `state.tasks`; import `dayTasksForWeek`/`weekStartOf` here too if not already imported):

```typescript
    async rescheduleTask(command) {
      const task = state.tasks.find((t) => t.id === command.taskId);
      if (!task || task.version !== command.taskVersion) {
        throw new TaskVersionConflictError();
      }
      const currentDate =
        task.scope.kind === "day"
          ? task.scope.date
          : task.scope.kind === "week" && task.rolledFrom?.kind === "day"
            ? task.rolledFrom.date
            : undefined;
      if (currentDate === undefined) {
        throw new Error("Only a day-scoped or rolled-over week-scoped task can be rescheduled.");
      }
      if (currentDate === command.date) {
        throw new Error("The task is already scheduled on this date.");
      }

      let updatedAnchor: Task | undefined;
      const anchorId = task.repeatSourceId;
      if (anchorId) {
        const anchor = state.tasks.find((t) => t.id === anchorId);
        if (anchor) {
          const existing = new Set(anchor.excludedDates ?? []);
          updatedAnchor = existing.has(currentDate)
            ? anchor
            : { ...anchor, version: anchor.version + 1, excludedDates: [...(anchor.excludedDates ?? []), currentDate] };
        }
      }

      const order = task.time
        ? task.order
        : Math.max(
            0,
            ...dayTasksForWeek(state.tasks, command.date, weekStartOf(command.date))
              .filter((t) => !t.time)
              .map((t) => t.order),
          ) + 1;

      const updatedTask: Task = {
        ...task,
        version: task.version + 1,
        scope: { kind: "day", date: command.date },
        rolledFrom: undefined,
        repeatSourceId: undefined,
        order,
      };

      state.tasks = state.tasks.map((t) => {
        if (t.id === updatedTask.id) return updatedTask;
        if (updatedAnchor && t.id === updatedAnchor.id) return updatedAnchor;
        return t;
      });
      return updatedAnchor ? { task: updatedTask, anchor: updatedAnchor } : { task: updatedTask };
    },
```

- [ ] **Step 10: Write the failing store test**

Add to `frontend/src/features/tasks/store.test.tsx` near the existing `rescheduleTaskToDay` tests:

```typescript
    it("rescheduleTaskToDay calls repo.rescheduleTask once and applies the anchor from the response for a repeat occurrence", async () => {
      const anchor = makeTask({ id: "anchor", scope: { kind: "day", date: "2026-07-01" }, repeatWeekdays: [4] });
      const occurrence = makeTask({
        id: "occ",
        scope: { kind: "day", date: "2026-07-16" },
        repeatSourceId: "anchor",
      });
      const { repo, result } = setup(fakeRepository([anchor, occurrence]));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      const rescheduleSpy = vi.spyOn(repo, "rescheduleTask");

      act(() => result.current.rescheduleTaskToDay("occ", "2026-07-20"));

      await waitFor(() =>
        expect(rescheduleSpy).toHaveBeenCalledWith({ taskId: "occ", taskVersion: 1, date: "2026-07-20" }),
      );
      await waitFor(() =>
        expect(result.current.tasks.find((t) => t.id === "anchor")?.excludedDates).toEqual(["2026-07-16"]),
      );
      expect(result.current.tasks.find((t) => t.id === "occ")?.scope).toEqual({
        kind: "day",
        date: "2026-07-20",
      });
    });
```

The existing `rescheduleTaskToDay` tests in that block (moves a plain task's scope date, no-op on the same date, does nothing for a week-scoped task, moves a rolled-over task clearing rolledFrom, order-appending variants) assert on `result.current.tasks` shape after the mutation resolves and should keep passing — they test outcomes the fake repository's `rescheduleTask` (Step 9) reproduces exactly, including the `dayTasksForWeek`-based order calc. Leave them as-is; if any fail after Step 11, treat it as a real regression to investigate, not a reason to delete the test.

- [ ] **Step 11: Run the tests to confirm they fail**

Run: `npx vitest run src/features/tasks/store.test.tsx -t rescheduleTaskToDay` from `frontend/`.
Expected: FAIL on the new test (`rescheduleTask` never called; current code still does two `persistUpdate` calls).

- [ ] **Step 12: Rewrite `rescheduleTaskToDay` in `store.tsx`**

Replace the existing `rescheduleTaskToDay` implementation (currently at approximately line 609) with:

```typescript
      rescheduleTaskToDay(id, date) {
        const current = tasksRef.current.find((t) => t.id === id);
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

        const order = current.time
          ? current.order
          : Math.max(
              0,
              ...dayTasksForWeek(tasksRef.current, date, weekStartOf(date))
                .filter((t) => !t.time)
                .map((t) => t.order),
            ) + 1;

        const updatedTask: Task = {
          ...current,
          scope: { kind: "day", date },
          rolledFrom: undefined,
          repeatSourceId: undefined,
          order,
        };
        const anchorId = current.repeatSourceId;
        const taskGeneration = nextMutationGeneration(current.id);
        const anchorGeneration = anchorId ? nextMutationGeneration(anchorId) : undefined;
        applyCommandState([updatedTask], []);

        enqueueMutation(async () => {
          const result = await repo.rescheduleTask({
            taskId: current.id,
            taskVersion: authoritativeVersionsRef.current.get(current.id) ?? current.version,
            date,
          });
          authoritativeVersionsRef.current.set(result.task.id, result.task.version);
          authoritativeTasksRef.current.set(result.task.id, result.task);

          const currentTask = tasksRef.current.find((t) => t.id === result.task.id);
          const reconciledTask =
            currentTask && mutationGenerationsRef.current.get(result.task.id) !== taskGeneration
              ? { ...currentTask, version: result.task.version }
              : result.task;

          const upserts = [reconciledTask];
          if (result.anchor) {
            authoritativeVersionsRef.current.set(result.anchor.id, result.anchor.version);
            authoritativeTasksRef.current.set(result.anchor.id, result.anchor);
            const currentAnchor = tasksRef.current.find((t) => t.id === result.anchor!.id);
            const reconciledAnchor =
              currentAnchor && anchorGeneration !== undefined &&
              mutationGenerationsRef.current.get(result.anchor.id) !== anchorGeneration
                ? { ...currentAnchor, version: result.anchor.version }
                : result.anchor;
            upserts.push(reconciledAnchor);
          }
          applyCommandState(upserts, []);
        });
      },
```

This drops the old second `persistUpdate(updatedAnchor)` call. Note the optimistic `applyCommandState` call above now also clears `repeatSourceId` (the old code only did this after the early-return checks, as a plain field mutation via `if (current.repeatSourceId !== undefined) { task.repeatSourceId = undefined; }` — folded here into the object literal directly since it's unconditional once we know we're proceeding).

- [ ] **Step 13: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/store.test.tsx -t rescheduleTaskToDay` from `frontend/`.
Expected: PASS, both the new test and all pre-existing `rescheduleTaskToDay` tests.

- [ ] **Step 14: Run the full frontend suite for regressions**

Run: `npx vitest run` from `frontend/`.
Expected: no new failures.

- [ ] **Step 15: Run the frontend typecheck and lint**

Run: `npx tsc --noEmit` and `npx next lint` from `frontend/`.
Expected: no new errors beyond whatever pre-existing ones were already there before this plan (compare against a baseline run if unsure).

- [ ] **Step 16: Commit**

```bash
git add frontend/src/features/tasks/data/repository.ts frontend/src/features/tasks/data/repository.test.ts frontend/src/features/tasks/data/api-task-repository.ts frontend/src/features/tasks/api/tasks.ts frontend/src/app/api/tasks/[id]/commands/reschedule/route.ts frontend/src/features/tasks/test-utils.tsx frontend/src/features/tasks/store.tsx frontend/src/features/tasks/store.test.tsx
git commit -m "feat: wire the Reschedule command into the frontend (RF-005 phase 1)"
```

---

## After all six tasks

Update `docs/refining/README.md`'s RF-005 row and `docs/refining/2026-08-06-transactional-task-commands.md` to record Detach/Delete-occurrence/Reschedule as implemented, matching the existing "Nest command"/"Promote-subtask command" sections' structure and tone. RF-005 stays **In progress** (not Resolved) until Reorder (phase 2) also lands — say so explicitly, the same way the existing doc currently says so for all four remaining commands. This documentation update is intentionally not its own task above since it has no test cycle of its own; do it as part of wrapping up Task 6, or as a small final commit once all six are merged.

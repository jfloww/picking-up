# RF-005 Phase 2 Reorder Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a versioned, atomic Reorder command (used identically by Daily's "All Day To-Do" and Weekly's per-day-column drag-to-reorder) and make task creation's `order` server-computed instead of client-supplied — closing the last two places `Task.order` is client-authoritative, completing RF-005.

**Architecture:** One `services.py` function (`reorder_task`) wrapped in `@transaction.atomic`, reusing `_lock_user`/`_locked_owned_tasks`/`_current_effective_date` from the existing command family; one command serializer/view/URL following the exact Detach/Reschedule shape; a server-side order computation for `POST /api/tasks/` that reuses the owner-row lock instead of trusting the request body. Frontend: one new store action (`reorderTask`) replacing both `day-agenda.tsx`'s and `weekly-view.tsx`'s local `computeOrderBetween` + `setOrder` sequences; `setOrder` itself is removed once nothing calls it, since leaving it in place would be the exact client-authority hole this phase closes.

**Tech Stack:** Django REST Framework (backend/apps/tasks), Next.js App Router route handlers (frontend/src/app/api), React state via a custom store hook (frontend/src/features/tasks/store.tsx), Vitest (frontend), Django's `TestCase` (backend).

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-08-07-rf005-phase2-reorder-design.md`.
- No `neighbor_version` precondition on Reorder — `insert_before_id` names a task whose `order` is only read, never written.
- The Reorder command's sibling query is the exact one `reschedule_task` already uses in `backend/apps/tasks/services.py`: `Q(scope_kind="day", scope_value=date) | Q(scope_kind="week", rolled_from_kind="day", rolled_from_value=date)`, untimed, **not** filtered by `done`.
- `404 Not Found` for a missing or cross-owner primary task, matching every existing command.
- Task creation's order computation preserves today's exact client rule (`nextUntimedOrderFor`): day-scope only, untimed, **excludes** done, `max(existing orders, 0) + 1`; any other `scope_kind` gets `order = 0.0`. Generic `PUT` on an existing task is untouched — this phase only changes `POST /api/tasks/` (create).
- Backend tests run via: `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks -v 2` from `backend/`.
- Frontend tests run via `npx vitest run <path>` from `frontend/`.
- Every new backend command view/serializer/URL follows the exact shape of `RescheduleTaskCommandView`/`RescheduleTaskCommandSerializer` in `backend/apps/tasks/views.py`/`serializers.py`.
- Every new frontend command follows the exact shape of `rescheduleTaskToDay` in `frontend/src/features/tasks/store.tsx` (optimistic `applyCommandState`, `nextMutationGeneration`, `enqueueMutation`, post-response reconciliation against `mutationGenerationsRef`) — simplified here since there is no anchor/secondary object.

---

## File Structure

**Backend (`backend/apps/tasks/`):**
- `services.py` — add `_order_between(before, after)`, `reorder_task(...)`, `ReorderTaskResult` dataclass, `_next_untimed_order_for_day(user, scope_value)`.
- `serializers.py` — add `ReorderTaskCommandSerializer`.
- `views.py` — add `ReorderTaskCommandView`; modify `TaskListCreateView.perform_create`.
- `../../config/urls.py` — register the new command path.
- `tests.py` — extend `TaskCommandApiTests` with `reorder()` helper + test cases; extend `TaskApiTests` (or wherever create tests live — check the file) with a creation-order test.

**Frontend:**
- `frontend/src/features/tasks/data/repository.ts` — add `ReorderTaskCommand`/`Result` types, `TaskRepository.reorderTask` method, `createLocalStorageRepository` implementation; remove `setOrder`'s... (no change needed here — `setOrder` was never part of `TaskRepository`, it's a store-only action operating through the generic `update`).
- `frontend/src/features/tasks/data/api-task-repository.ts` — `reorderTask` implementation.
- `frontend/src/features/tasks/api/tasks.ts` — `requestReorderTask`.
- `frontend/src/app/api/tasks/[id]/commands/reorder/route.ts` — new BFF route.
- `frontend/src/features/tasks/test-utils.tsx` — `reorderTask` fake implementation.
- `frontend/src/features/tasks/store.tsx` — add `reorderTask(id, insertBeforeId)`; remove `setOrder`.
- `frontend/src/features/tasks/components/day-agenda.tsx` — `handleReorder` calls `actions.reorderTask` directly, drops its own `computeOrderBetween` call and the now-unused import.
- `frontend/src/features/tasks/components/views/weekly-view.tsx` — same change to its `onReorder` handler.
- Tests: `frontend/src/features/tasks/data/repository.test.ts`, `store.test.tsx` (replace the `setOrder` test with `reorderTask` tests), `day-agenda.test.tsx` (one test-name cosmetic fix, everything else unchanged), `api-task-repository.route-integration.test.ts`.

---

## Task 1: Backend — Reorder command

**Files:**
- Modify: `backend/apps/tasks/services.py`
- Modify: `backend/apps/tasks/serializers.py`
- Modify: `backend/apps/tasks/views.py`
- Modify: `backend/config/urls.py`
- Test: `backend/apps/tasks/tests.py`

**Interfaces:**
- Consumes: `_lock_user`, `_locked_owned_tasks`, `_assert_versions`, `_current_effective_date`, `TaskCommandNotFound`, `TaskVersionConflict`, `TaskCommandConflict` — all already in `services.py`.
- Produces: `_order_between(before: float | None, after: float | None) -> float`, `reorder_task(*, user, task_id, task_version: int, insert_before_id) -> ReorderTaskResult` where `ReorderTaskResult` has field `task: Task`. Domain conflict codes: `not_reorderable`, `same_position` is NOT a code here (unlike Reschedule) — a client-side no-op guard already prevents a same-position reorder from ever reaching the network (see Task 3), so the server does not need its own no-op short-circuit; a redundant identical-value write is harmless and simply bumps the version, matching how every other generic update behaves.

- [ ] **Step 1: Write the failing tests**

Add to `TaskCommandApiTests` in `backend/apps/tasks/tests.py`:

```python
    def reorder(self, task, insert_before_id, **overrides):
        payload = {
            "task_version": task.version,
            "insert_before_id": insert_before_id,
        }
        payload.update(overrides)
        return self.client.post(
            f"/api/tasks/{task.id}/commands/reorder/",
            payload,
            format="json",
        )

    def test_reorder_moves_a_task_between_two_siblings(self):
        first = self.create_task(title="first", scope_value="2026-07-16", order=1.0)
        second = self.create_task(title="second", scope_value="2026-07-16", order=2.0)
        third = self.create_task(title="third", scope_value="2026-07-16", order=3.0)

        response = self.reorder(first, str(third.id))

        self.assertEqual(response.status_code, 200, response.data)
        first.refresh_from_db()
        self.assertEqual(first.order, 2.5)
        self.assertEqual(first.version, 2)
        self.assertEqual(response.data["task"]["order"], 2.5)

    def test_reorder_moves_a_task_to_the_end_with_a_null_insert_before_id(self):
        first = self.create_task(title="first", scope_value="2026-07-16", order=1.0)
        second = self.create_task(title="second", scope_value="2026-07-16", order=2.0)

        response = self.reorder(first, None)

        self.assertEqual(response.status_code, 200, response.data)
        first.refresh_from_db()
        self.assertEqual(first.order, 3.0)

    def test_reorder_inserting_before_the_first_sibling_uses_the_edge_gap(self):
        first = self.create_task(title="first", scope_value="2026-07-16", order=1.0)
        second = self.create_task(title="second", scope_value="2026-07-16", order=2.0)

        response = self.reorder(second, str(first.id))

        self.assertEqual(response.status_code, 200, response.data)
        second.refresh_from_db()
        self.assertEqual(second.order, 0.0)

    def test_reorder_counts_a_done_sibling_rolled_over_from_this_day(self):
        # Mirrors Weekly's rendering: a done, rolled-over week-scoped task is
        # still a real sibling that must count towards "the end of the list."
        rolled_over_done = self.create_task(
            title="done and rolled over",
            scope_kind="week",
            scope_value="2026-07-20",
            rolled_from_kind="day",
            rolled_from_value="2026-07-16",
            done=True,
            order=5.0,
        )
        moving = self.create_task(title="moving", scope_value="2026-07-16", order=1.0)

        response = self.reorder(moving, None)

        self.assertEqual(response.status_code, 200, response.data)
        moving.refresh_from_db()
        self.assertEqual(moving.order, 6.0)

    def test_reorder_rejects_a_timed_task_as_not_reorderable(self):
        timed = self.create_task(title="timed", scope_value="2026-07-16", time="09:00")

        response = self.reorder(timed, None)

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "not_reorderable")

    def test_reorder_rejects_a_month_scoped_task_as_not_reorderable(self):
        goal = self.create_task(title="goal", scope_kind="month", scope_value="2026-07")

        response = self.reorder(goal, None)

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "not_reorderable")

    def test_reorder_rejects_a_nonexistent_neighbor_as_invalid(self):
        task = self.create_task(title="alone", scope_value="2026-07-16")

        response = self.reorder(task, str(uuid.uuid4()))

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "invalid_neighbor")

    def test_reorder_rejects_a_neighbor_on_a_different_day_as_invalid(self):
        task = self.create_task(title="here", scope_value="2026-07-16")
        elsewhere = self.create_task(title="elsewhere", scope_value="2026-07-17")

        response = self.reorder(task, str(elsewhere.id))

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "invalid_neighbor")

    def test_reorder_rejects_a_timed_task_as_an_invalid_neighbor(self):
        task = self.create_task(title="here", scope_value="2026-07-16")
        timed_sibling = self.create_task(title="timed sibling", scope_value="2026-07-16", time="10:00")

        response = self.reorder(task, str(timed_sibling.id))

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "invalid_neighbor")

    def test_reorder_rejects_a_cross_owner_neighbor_as_invalid(self):
        task = self.create_task(title="here", scope_value="2026-07-16")
        other_user, other_client = auth_client("reorder-other@example.com")
        other_task = Task.objects.create(
            id=uuid.uuid4(), user=other_user, title="not yours",
            scope_kind="day", scope_value="2026-07-16",
        )

        response = self.reorder(task, str(other_task.id))

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "invalid_neighbor")

    def test_reorder_rejects_the_tasks_own_id_as_an_invalid_neighbor(self):
        task = self.create_task(title="here", scope_value="2026-07-16")

        response = self.reorder(task, str(task.id))

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "invalid_neighbor")

    def test_reorder_returns_409_for_a_stale_version(self):
        task = self.create_task(title="here", scope_value="2026-07-16")

        response = self.reorder(task, None, task_version=task.version + 1)

        self.assertEqual(response.status_code, 409, response.data)

    def test_reorder_returns_404_for_a_missing_or_unowned_task(self):
        response = self.client.post(
            f"/api/tasks/{uuid.uuid4()}/commands/reorder/",
            {"task_version": 1, "insert_before_id": None},
            format="json",
        )
        self.assertEqual(response.status_code, 404)
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks.tests.TaskCommandApiTests -v 2` from `backend/`.
Expected: every `test_reorder_*` test fails (404 route not found).

- [ ] **Step 3: Implement `_order_between` and `reorder_task` in `services.py`**

Add near the top of `backend/apps/tasks/services.py`, after `_current_effective_date`:

```python
_EDGE_GAP = 1.0


def _order_between(before: float | None, after: float | None) -> float:
    if before is None and after is None:
        return 0.0
    if before is None:
        return after - _EDGE_GAP
    if after is None:
        return before + _EDGE_GAP
    return (before + after) / 2.0
```

Add after `reschedule_task`:

```python
@dataclass(frozen=True)
class ReorderTaskResult:
    task: Task


@transaction.atomic
def reorder_task(
    *,
    user,
    task_id,
    task_version: int,
    insert_before_id,
) -> ReorderTaskResult:
    _lock_user(user)
    task_key = str(task_id)
    tasks = _locked_owned_tasks(user, [task_id])
    if task_key not in tasks:
        raise TaskCommandNotFound

    task = tasks[task_key]
    _assert_versions({task_key: task_version}, tasks)

    date = _current_effective_date(task)
    if task.time or date is None:
        raise TaskCommandConflict(
            "not_reorderable",
            "Only an untimed day-scoped or rolled-over week-scoped task can be reordered.",
        )

    # Same sibling rule reschedule_task uses: day-scope or rolled-over
    # week-scope at this date, untimed, not filtered by done — Weekly
    # interleaves done and not-done untimed tasks in one order-sorted list,
    # so a done sibling must still count.
    siblings = list(
        Task.objects.select_for_update()
        .filter(user=user)
        .filter(
            Q(scope_kind="day", scope_value=date)
            | Q(scope_kind="week", rolled_from_kind="day", rolled_from_value=date)
        )
        .filter(Q(time__isnull=True) | Q(time=""))
        .exclude(id=task.id)
        .order_by("order", "id")
    )

    if insert_before_id is None:
        before = siblings[-1] if siblings else None
        after = None
    else:
        insert_before_key = str(insert_before_id)
        match_index = next(
            (i for i, sibling in enumerate(siblings) if str(sibling.id) == insert_before_key),
            None,
        )
        if match_index is None:
            raise TaskCommandConflict(
                "invalid_neighbor",
                "The neighbor task is not a valid insertion point.",
            )
        after = siblings[match_index]
        before = siblings[match_index - 1] if match_index > 0 else None

    task.order = _order_between(
        before.order if before else None,
        after.order if after else None,
    )
    task.version += 1
    task.save(update_fields=["order", "version", "updated_at"])

    return ReorderTaskResult(task=task)
```

`Q` is already imported at the top of `services.py` — no new import needed for this step.

- [ ] **Step 4: Add `ReorderTaskCommandSerializer` to `serializers.py`**

```python
class ReorderTaskCommandSerializer(serializers.Serializer):
    task_version = serializers.IntegerField(min_value=1)
    insert_before_id = serializers.UUIDField(allow_null=True, required=False, default=None)
```

- [ ] **Step 5: Add `ReorderTaskCommandView` to `views.py` and register the URL**

Update `views.py`'s `serializers`/`services` imports to include `ReorderTaskCommandSerializer` and `reorder_task`. Add the view after `RescheduleTaskCommandView`:

```python
class ReorderTaskCommandView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request, pk):
        serializer = ReorderTaskCommandSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            result = reorder_task(
                user=request.user,
                task_id=pk,
                task_version=data["task_version"],
                insert_before_id=data["insert_before_id"],
            )
        except TaskCommandNotFound as exc:
            raise NotFound from exc
        except TaskVersionConflict as exc:
            raise TaskVersionConflictResponse(exc.current_versions) from exc
        except TaskCommandConflict as exc:
            raise TaskCommandConflictResponse(exc) from exc

        return Response(
            {"task": TaskSerializer(result.task, context={"request": request}).data},
            status=status.HTTP_200_OK,
        )
```

In `backend/config/urls.py`, import `ReorderTaskCommandView` and register, after the reschedule path:

```python
    path(
        "api/tasks/<uuid:pk>/commands/reorder/",
        ReorderTaskCommandView.as_view(),
        name="task-command-reorder",
    ),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks.tests.TaskCommandApiTests -v 2` from `backend/`.
Expected: PASS, all `test_reorder_*` tests green, no regressions.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/tasks/services.py backend/apps/tasks/serializers.py backend/apps/tasks/views.py backend/config/urls.py backend/apps/tasks/tests.py
git commit -m "feat: add the Reorder command (RF-005 phase 2)"
```

---

## Task 2: Backend — Server-owned creation order

**Files:**
- Modify: `backend/apps/tasks/services.py`
- Modify: `backend/apps/tasks/views.py`
- Test: `backend/apps/tasks/tests.py`

**Interfaces:**
- Consumes: `_lock_user` (already in `services.py`).
- Produces: `_next_untimed_order_for_day(user, scope_value: str) -> float`.

- [ ] **Step 1: Write the failing test**

First, find the existing task-creation test class in `backend/apps/tasks/tests.py` (search for `class TaskApiTests` or similar — the one testing `POST /api/tasks/`) and read a couple of its existing tests to match its exact request/assertion style before writing this one. Add:

```python
    def test_create_ignores_a_client_supplied_order_and_appends_past_existing_siblings(self):
        self.create_task(title="existing", scope_value="2026-07-16", order=3.0)

        response = self.client.post(
            "/api/tasks/",
            make_task_payload(title="new", scope_value="2026-07-16", order=999.0),
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["order"], 4.0)

    def test_create_ignores_done_siblings_when_computing_the_appended_order(self):
        self.create_task(title="done sibling", scope_value="2026-07-16", order=10.0, done=True)

        response = self.client.post(
            "/api/tasks/",
            make_task_payload(title="new", scope_value="2026-07-16"),
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["order"], 1.0)

    def test_create_uses_order_zero_for_a_non_day_scope_regardless_of_client_input(self):
        response = self.client.post(
            "/api/tasks/",
            make_task_payload(title="goal", scope_kind="month", scope_value="2026-07", order=42.0),
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["order"], 0.0)
```

Note: `make_task_payload` doesn't currently accept `order` as a documented override — check its `**overrides` passthrough (it already merges any override into the payload dict, so `order=999.0` will work even though `order` isn't in the base dict) before assuming; if it needs an explicit `order` key added to the base payload dict, add one (default `0.0`) rather than guessing.

- [ ] **Step 2: Run the tests to confirm they fail**

Django's test runner has no `pytest -k`-style substring filter — target the specific tests by dotted path instead:

Run: `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks.tests.TaskApiTests.test_create_ignores_a_client_supplied_order_and_appends_past_existing_siblings apps.tasks.tests.TaskApiTests.test_create_ignores_done_siblings_when_computing_the_appended_order apps.tasks.tests.TaskApiTests.test_create_uses_order_zero_for_a_non_day_scope_regardless_of_client_input -v 2` from `backend/` (substitute the correct class name from Step 1's file search if it isn't `TaskApiTests`).
Expected: FAIL — the response's `order` currently echoes back whatever the client sent (999.0, 42.0), not the server-computed value.

- [ ] **Step 3: Implement `_next_untimed_order_for_day` in `services.py`**

Add near `_order_between` (Task 1) or `_promotion_order`, whichever this ends up sitting closer to after Task 1 lands:

```python
def _next_untimed_order_for_day(user, scope_value: str) -> float:
    siblings = Task.objects.filter(
        user=user, scope_kind="day", scope_value=scope_value, done=False,
    ).filter(Q(time__isnull=True) | Q(time=""))
    max_order = siblings.aggregate(Max("order"))["order__max"]
    return (max_order or 0.0) + 1.0
```

Add `Max` to the existing `from django.db.models import Q` import line at the top of `services.py`, making it `from django.db.models import Max, Q`.

- [ ] **Step 4: Override `TaskListCreateView.perform_create` in `views.py`**

Update `views.py`'s `services` import to also include `_lock_user` and `_next_untimed_order_for_day`.

Replace the existing `perform_create`:

```python
    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
```

with:

```python
    def perform_create(self, serializer):
        with transaction.atomic():
            _lock_user(self.request.user)
            scope_kind = serializer.validated_data.get("scope_kind")
            scope_value = serializer.validated_data.get("scope_value")
            order = (
                _next_untimed_order_for_day(self.request.user, scope_value)
                if scope_kind == "day"
                else 0.0
            )
            serializer.save(user=self.request.user, order=order)
```

`transaction` is already imported at the top of `views.py` (`from django.db import IntegrityError, transaction`). Passing `order=order` to `.save()` overrides whatever the client sent in the request body — DRF's `Serializer.save(**kwargs)` merges kwargs over `validated_data` before calling `create()`, the same mechanism `perform_create`'s existing `user=self.request.user` already relies on. `TaskSerializer.order` itself is left as a normal writable field in the schema (still used, unchanged, by generic `PUT` on existing tasks) — this override is create-path-only, the same targeted approach `TaskSerializer.update()` already uses for discarding a client-supplied `id`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks -v 2` from `backend/`.
Expected: PASS, full `apps.tasks` suite green, no regressions in any other create-path test (double-check no existing test asserted a specific *other* order value on create that this now changes — if one exists and its expected value doesn't match `_next_untimed_order_for_day`'s rule, that's a real pre-existing-test conflict to resolve, not silently paper over).

- [ ] **Step 6: Commit**

```bash
git add backend/apps/tasks/services.py backend/apps/tasks/views.py backend/apps/tasks/tests.py
git commit -m "feat: compute Task creation order server-side (RF-005 phase 2)"
```

---

## Task 3: Frontend — Reorder command wiring (Daily + Weekly)

**Files:**
- Modify: `frontend/src/features/tasks/data/repository.ts`
- Modify: `frontend/src/features/tasks/data/api-task-repository.ts`
- Modify: `frontend/src/features/tasks/api/tasks.ts`
- Create: `frontend/src/app/api/tasks/[id]/commands/reorder/route.ts`
- Modify: `frontend/src/features/tasks/test-utils.tsx`
- Modify: `frontend/src/features/tasks/store.tsx`
- Modify: `frontend/src/features/tasks/components/day-agenda.tsx`
- Modify: `frontend/src/features/tasks/components/views/weekly-view.tsx`
- Test: `frontend/src/features/tasks/data/repository.test.ts`, `frontend/src/features/tasks/store.test.tsx`, `frontend/src/features/tasks/components/day-agenda.test.tsx`, `frontend/src/features/tasks/data/api-task-repository.route-integration.test.ts`

**Interfaces:**
- Consumes (backend, Task 1): `POST /api/tasks/{id}/commands/reorder/` → `{ task: ApiTask }`, `409` with `code: "not_reorderable" | "invalid_neighbor"`.
- Produces: `TaskRepository.reorderTask(command: ReorderTaskCommand): Promise<ReorderTaskResult>` where `ReorderTaskCommand = { taskId: string; taskVersion: number; insertBeforeId: string | null }` and `ReorderTaskResult = { task: Task }`. Store action: `reorderTask(id: string, insertBeforeId: string | null): void`, replacing `setOrder`, which is removed from the store's action interface entirely.

- [ ] **Step 1: Add types and the `TaskRepository` interface method in `repository.ts`**

```typescript
export interface ReorderTaskCommand {
  taskId: string;
  taskVersion: number;
  insertBeforeId: string | null;
}

export interface ReorderTaskResult {
  task: Task;
}
```

Add `reorderTask(command: ReorderTaskCommand): Promise<ReorderTaskResult>;` to the `TaskRepository` interface.

- [ ] **Step 2: Write the failing `createLocalStorageRepository` tests**

Add to `frontend/src/features/tasks/data/repository.test.ts` (read the file first to match its existing `nestTask`/`detachTask`/`rescheduleTask` test fixture conventions exactly):

```typescript
  it("reorderTask computes the midpoint between the two neighbors around the insertion point", async () => {
    const repo = createLocalStorageRepository(storage);
    const first = makeTask({ id: "f", scope: { kind: "day", date: "2026-07-16" }, order: 1 });
    const second = makeTask({ id: "s", scope: { kind: "day", date: "2026-07-16" }, order: 2 });
    const third = makeTask({ id: "t", scope: { kind: "day", date: "2026-07-16" }, order: 3 });
    storage.setItem(STORAGE_KEY, JSON.stringify([first, second, third]));

    const result = await repo.reorderTask({ taskId: "f", taskVersion: 1, insertBeforeId: "t" });

    expect(result.task.order).toBe(2.5);
  });

  it("reorderTask appends past every sibling when insertBeforeId is null", async () => {
    const repo = createLocalStorageRepository(storage);
    const first = makeTask({ id: "f", scope: { kind: "day", date: "2026-07-16" }, order: 1 });
    const second = makeTask({ id: "s", scope: { kind: "day", date: "2026-07-16" }, order: 2 });
    storage.setItem(STORAGE_KEY, JSON.stringify([first, second]));

    const result = await repo.reorderTask({ taskId: "f", taskVersion: 1, insertBeforeId: null });

    expect(result.task.order).toBe(3);
  });

  it("reorderTask throws TaskVersionConflictError on a stale version", async () => {
    const repo = createLocalStorageRepository(storage);
    const task = makeTask({ id: "a", scope: { kind: "day", date: "2026-07-16" } });
    storage.setItem(STORAGE_KEY, JSON.stringify([task]));

    await expect(
      repo.reorderTask({ taskId: "a", taskVersion: 99, insertBeforeId: null }),
    ).rejects.toThrow(TaskVersionConflictError);
  });
```

- [ ] **Step 3: Run the tests to confirm they fail**

Run: `npx vitest run src/features/tasks/data/repository.test.ts` from `frontend/`.
Expected: FAIL — `repo.reorderTask is not a function`.

- [ ] **Step 4: Implement `reorderTask` in `createLocalStorageRepository`**

Add to the object returned by `createLocalStorageRepository`, after `rescheduleTask` (Phase 1's last addition to this object):

```typescript
    async reorderTask(command) {
      const tasks = read();
      const task = tasks.find((t) => t.id === command.taskId);
      if (!task || task.version !== command.taskVersion) {
        throw new TaskVersionConflictError();
      }
      const date =
        task.scope.kind === "day"
          ? task.scope.date
          : task.scope.kind === "week" && task.rolledFrom?.kind === "day"
            ? task.rolledFrom.date
            : undefined;
      if (task.time || date === undefined) {
        throw new Error("Only an untimed day-scoped or rolled-over week-scoped task can be reordered.");
      }
      const siblings = dayTasksForWeek(tasks, date, weekStartOf(date))
        .filter((t) => !t.time && t.id !== task.id)
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

      let before: Task | undefined;
      let after: Task | undefined;
      if (command.insertBeforeId === null) {
        before = siblings[siblings.length - 1];
        after = undefined;
      } else {
        const matchIndex = siblings.findIndex((t) => t.id === command.insertBeforeId);
        if (matchIndex === -1) {
          throw new Error("The neighbor task is not a valid insertion point.");
        }
        after = siblings[matchIndex];
        before = matchIndex > 0 ? siblings[matchIndex - 1] : undefined;
      }

      const updatedTask: Task = {
        ...task,
        version: task.version + 1,
        order: computeOrderBetween(before?.order, after?.order),
      };
      write(tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t)));
      return { task: updatedTask };
    },
```

Add `dayTasksForWeek` and `weekStartOf` to this file's existing `../lib/times`/`../lib/dates` imports if not already present (check Task 6 of the Phase 1 plan — `rescheduleTask`'s implementation in this same file already needed both; confirm the exact import lines already there before adding duplicates), and add `computeOrderBetween` to this file's import from `../lib/reorder` alongside the already-imported `promotedSubtaskOrder`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/data/repository.test.ts` from `frontend/`.
Expected: PASS.

- [ ] **Step 6: Add the API repository implementation**

In `api-task-repository.ts`, add `ReorderTaskResult` to the `./repository` import, then add to the returned object, after `rescheduleTask`:

```typescript
    async reorderTask(command) {
      const response = await taskFetch(`/api/tasks/${command.taskId}/commands/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      });
      await guardTaskMutation(response, redirectToLogin);
      return (await response.json()) as ReorderTaskResult;
    },
```

- [ ] **Step 7: Add the BFF request function**

In `frontend/src/features/tasks/api/tasks.ts`, add after `requestRescheduleTask`:

```typescript
export interface ReorderTaskRequest {
  taskVersion: number;
  insertBeforeId: string | null;
}

export interface ReorderTaskResponse {
  task: Task;
  status: number;
}

export async function requestReorderTask(
  taskId: string,
  command: ReorderTaskRequest,
): Promise<ReorderTaskResponse> {
  const response = await taskMutationRequest(`/api/tasks/${taskId}/commands/reorder/`, {
    method: "POST",
    body: JSON.stringify({
      task_version: command.taskVersion,
      insert_before_id: command.insertBeforeId,
    }),
  });
  const payload = (await response.json()) as { task: ApiTask };
  return { task: fromApiPayload(payload.task), status: response.status };
}
```

- [ ] **Step 8: Add the Next.js BFF route**

Create `frontend/src/app/api/tasks/[id]/commands/reorder/route.ts`:

```typescript
import { NextResponse, type NextRequest } from "next/server";

import {
  TaskApiError,
  requestReorderTask,
  type ReorderTaskRequest,
} from "@/features/tasks/api/tasks";
import { ApiUnauthorizedError } from "@/lib/api/server";
import { unauthorizedResponse } from "@/lib/auth/cookies";

function parseReorderCommand(body: unknown): ReorderTaskRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.taskVersion !== "number") return null;
  if (candidate.insertBeforeId !== null && typeof candidate.insertBeforeId !== "string") return null;
  return {
    taskVersion: candidate.taskVersion,
    insertBeforeId: candidate.insertBeforeId as string | null,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const command = parseReorderCommand(await request.json());
    if (command === null) {
      return NextResponse.json(
        { error: "taskVersion (number) is required; insertBeforeId must be a string or null." },
        { status: 400 },
      );
    }
    const result = await requestReorderTask(id, command);
    return NextResponse.json({ task: result.task }, { status: result.status });
  } catch (error) {
    if (error instanceof ApiUnauthorizedError) return unauthorizedResponse();
    if (error instanceof TaskApiError) {
      return NextResponse.json(error.body ?? { error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reorder task." },
      { status: 400 },
    );
  }
}
```

- [ ] **Step 9: Add the fake repository implementation**

In `test-utils.tsx`, add the same logic as Step 4 (Local storage), operating on `state.tasks` instead of `read()`/`write()`, after `rescheduleTask`:

```typescript
    async reorderTask(command) {
      const task = state.tasks.find((t) => t.id === command.taskId);
      if (!task || task.version !== command.taskVersion) {
        throw new TaskVersionConflictError();
      }
      const date =
        task.scope.kind === "day"
          ? task.scope.date
          : task.scope.kind === "week" && task.rolledFrom?.kind === "day"
            ? task.rolledFrom.date
            : undefined;
      if (task.time || date === undefined) {
        throw new Error("Only an untimed day-scoped or rolled-over week-scoped task can be reordered.");
      }
      const siblings = dayTasksForWeek(state.tasks, date, weekStartOf(date))
        .filter((t) => !t.time && t.id !== task.id)
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

      let before: Task | undefined;
      let after: Task | undefined;
      if (command.insertBeforeId === null) {
        before = siblings[siblings.length - 1];
        after = undefined;
      } else {
        const matchIndex = siblings.findIndex((t) => t.id === command.insertBeforeId);
        if (matchIndex === -1) {
          throw new Error("The neighbor task is not a valid insertion point.");
        }
        after = siblings[matchIndex];
        before = matchIndex > 0 ? siblings[matchIndex - 1] : undefined;
      }

      const updatedTask: Task = {
        ...task,
        version: task.version + 1,
        order: computeOrderBetween(before?.order, after?.order),
      };
      state.tasks = state.tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t));
      return { task: updatedTask };
    },
```

Add `computeOrderBetween` to this file's existing `../lib/reorder` import alongside `promotedSubtaskOrder` if not already present.

- [ ] **Step 10: Write the failing store test, replacing the old `setOrder` test**

In `frontend/src/features/tasks/store.test.tsx`, remove the existing test:

```typescript
  it("setOrder updates a task's order and persists it", async () => {
    const task = makeTask({ id: "a", order: 1, scope: { kind: "day", date: todayKey() } });
    const { repo, result } = setup(fakeRepository([task]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.setOrder("a", 2.5));

    expect(result.current.tasks[0].order).toBe(2.5);
    await waitFor(() => expect(repo.tasks[0].order).toBe(2.5));
  });
```

Replace it with:

```typescript
  it("reorderTask calls repo.reorderTask and applies the authoritative order from the response", async () => {
    const first = makeTask({ id: "f", scope: { kind: "day", date: todayKey() }, order: 1 });
    const second = makeTask({ id: "s", scope: { kind: "day", date: todayKey() }, order: 2 });
    const { repo, result } = setup(fakeRepository([first, second]));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const reorderSpy = vi.spyOn(repo, "reorderTask");

    act(() => result.current.reorderTask("f", null));

    await waitFor(() =>
      expect(reorderSpy).toHaveBeenCalledWith({ taskId: "f", taskVersion: 1, insertBeforeId: null }),
    );
    await waitFor(() => expect(result.current.tasks.find((t) => t.id === "f")?.order).toBe(3));
  });

  it("reorderTask returns 409 as a domain conflict, not a version-changed banner, for an invalid neighbor", async () => {
    const task = makeTask({ id: "a", scope: { kind: "day", date: todayKey() } });
    const { repo, result } = setup(fakeRepository([task]));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    vi.spyOn(repo, "reorderTask").mockRejectedValueOnce(
      new TaskVersionConflictError("invalid_neighbor"),
    );

    act(() => result.current.reorderTask("a", "does-not-exist"));

    await waitFor(() => expect(result.current.syncError).toBeTruthy());
    expect(result.current.syncError).not.toContain("changed elsewhere");
  });
```

`syncError: string | null` is the confirmed store-state field name (`store.tsx`'s reducer, `syncErrorOccurred`/`syncErrorDismissed` actions), and `CONFLICT_ERROR_MESSAGE = "A task changed elsewhere. Refreshing to show the latest…"` is the exact string the `not.toContain` assertion above guards against. `TaskVersionConflictError`'s constructor is `(code = "task_version_conflict", currentVersions?: Record<string, number>)`.

- [ ] **Step 11: Run the tests to confirm they fail**

Run: `npx vitest run src/features/tasks/store.test.tsx -t reorderTask` from `frontend/`.
Expected: FAIL — `result.current.reorderTask` doesn't exist yet.

- [ ] **Step 12: Add `reorderTask` to `store.tsx` and remove `setOrder`**

Remove the existing `setOrder` action:

```typescript
      setOrder(id, order) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, order };
        persistUpdate(task);
      },
```

and its entry in the store's action-interface type (search for `setOrder:` in the interface block near the top of the file, alongside `setPriority`/`setDuration`/etc., and remove that line too).

Add in its place:

```typescript
      reorderTask(id, insertBeforeId) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current) return;

        const generation = nextMutationGeneration(current.id);

        enqueueMutation(async () => {
          const result = await repo.reorderTask({
            taskId: current.id,
            taskVersion: authoritativeVersionsRef.current.get(current.id) ?? current.version,
            insertBeforeId,
          });
          authoritativeVersionsRef.current.set(result.task.id, result.task.version);
          authoritativeTasksRef.current.set(result.task.id, result.task);

          const currentTask = tasksRef.current.find((t) => t.id === result.task.id);
          const reconciledTask =
            currentTask && mutationGenerationsRef.current.get(result.task.id) !== generation
              ? { ...currentTask, version: result.task.version, order: result.task.order }
              : result.task;
          applyCommandState([reconciledTask], []);
        });
      },
```

Add `reorderTask(id: string, insertBeforeId: string | null): void;` to the action-interface type where `setOrder`'s line was removed.

Note this command has **no synchronous optimistic `applyCommandState` call before `enqueueMutation`**, unlike Detach/Reschedule — the drag gesture's own visual feedback (the drop indicator, card reordering during drag) is already handled by `use-drag-to-reorder.ts`'s local `dragState`, entirely independent of the store; the store's task list only needs to reflect the final `order` once the command resolves. If a store-level test expects a synchronous optimistic order change here, that's a real requirement this step missed — check for one via the same kind of grep Phase 1 used (`grep -n "reorderTask" store.test.tsx` after Step 10) before concluding this is safe to skip.

- [ ] **Step 13: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/store.test.tsx -t reorderTask` from `frontend/`.
Expected: PASS.

- [ ] **Step 14: Update `day-agenda.tsx`'s `handleReorder` to call the store action directly**

Replace:

```typescript
  function handleReorder(id: string, insertBeforeId: string | null) {
    const currentIndex = allDayToDo.findIndex((t) => t.id === id);
    if (currentIndex === -1) return;
    const dragged = allDayToDo[currentIndex];
    const remaining = allDayToDo.filter((t) => t.id !== id);
    const targetIndex =
      insertBeforeId === null ? remaining.length : remaining.findIndex((t) => t.id === insertBeforeId);
    if (targetIndex === -1) return;
    // Compare list *positions*, not just the resolved order value: the
    // dragged item currently sits at currentIndex within allDayToDo
    // (dragged still present). Removing it to build `remaining` shifts
    // every later index down by one, so the slot it already occupies is
    // targetIndex === currentIndex in `remaining`'s index space — e.g.
    // dropping it directly above its current next-neighbor recomputes
    // the same position even though insertBeforeId now names a
    // *different* neighbor than "itself." Catching that here (rather
    // than only `id === insertBeforeId`) avoids a no-op drag firing a
    // real setOrder/network call.
    if (targetIndex === currentIndex) return;
    const before = remaining[targetIndex - 1]?.order;
    const after = remaining[targetIndex]?.order;
    const newOrder = computeOrderBetween(before, after);
    if (newOrder === dragged.order) return;
    actions.setOrder(id, newOrder);
  }
```

with:

```typescript
  function handleReorder(id: string, insertBeforeId: string | null) {
    const currentIndex = allDayToDo.findIndex((t) => t.id === id);
    if (currentIndex === -1) return;
    const remaining = allDayToDo.filter((t) => t.id !== id);
    const targetIndex =
      insertBeforeId === null ? remaining.length : remaining.findIndex((t) => t.id === insertBeforeId);
    if (targetIndex === -1) return;
    // Compare list *positions*, not just a resolved order value: the
    // dragged item currently sits at currentIndex within allDayToDo
    // (dragged still present). Removing it to build `remaining` shifts
    // every later index down by one, so the slot it already occupies is
    // targetIndex === currentIndex in `remaining`'s index space — e.g.
    // dropping it directly above its current next-neighbor recomputes
    // the same position even though insertBeforeId now names a
    // *different* neighbor than "itself." Catching that here (rather
    // than only `id === insertBeforeId`) avoids a no-op drag firing a
    // real reorderTask/network call — the server has no cheap way to
    // detect "this would be a no-op" itself without first doing the same
    // work the client just did.
    if (targetIndex === currentIndex) return;
    actions.reorderTask(id, insertBeforeId);
  }
```

Remove the now-unused `computeOrderBetween` import from this file's `../lib/reorder` import line (check whether anything else in this file still needs it before deleting the whole import line — if it's the only name imported from that module in this file, delete the line entirely).

- [ ] **Step 15: Update `weekly-view.tsx`'s equivalent handler**

Apply the identical transformation to the `onReorder` callback passed to `useDragToRescheduleOrReorder` (currently computing `newOrder` via `computeOrderBetween` and calling `actions.setOrder`): replace the order computation with a direct `actions.reorderTask(id, insertBeforeId)` call, keeping the existing `targetIndex === currentIndex` no-op guard. Remove the now-unused `computeOrderBetween` import from this file if nothing else in it still needs it.

- [ ] **Step 16: Fix the one stale test name in `day-agenda.test.tsx`**

The test at approximately line 302, `"releasing outside the All Day To-Do list cancels the drag: no setOrder, order unchanged, no indicator"`, does not actually spy on `setOrder` anywhere in its body — it only asserts `repo.tasks.find((t) => t.id === "f")?.order` is unchanged, an outcome that holds identically against the new `reorderTask`-based implementation. No test logic changes. Rename the test's title only, to stop referencing a store action that no longer exists:

```typescript
  it("releasing outside the All Day To-Do list cancels the drag: no reorderTask call, order unchanged, no indicator", async () => {
```

- [ ] **Step 17: Run the full frontend suite for regressions**

Run: `npx vitest run` from `frontend/`.
Expected: no new failures. The three drag-interaction tests in `day-agenda.test.tsx` (lines ~261, ~302, ~347 before this task's edits) and their Weekly equivalents should pass unchanged — they assert on persisted outcomes (`repo.tasks[...].order`, DOM ordering) reachable through the real pointer-event gesture, and the fake repository's `reorderTask` (Step 9) reproduces the exact same midpoint math `computeOrderBetween` did, so the observable results are identical even though the code path changed. If any of them fail, treat it as a real regression to investigate — not a reason to delete or loosen the assertion.

- [ ] **Step 18: Add route-integration coverage**

In `frontend/src/features/tasks/data/api-task-repository.route-integration.test.ts`, following the exact pattern the Phase 1 fix wave added for `detachTask`/`deleteOccurrence`/`rescheduleTask` (read those additions first): import the real `POST` handler from `frontend/src/app/api/tasks/[id]/commands/reorder/route.ts`, add a dispatch branch for it in the router, and add three tests — a success round-trip, a malformed-body 400 rejection (no Django call), and a `409` (`not_reorderable` or `invalid_neighbor`) passthrough as the typed conflict shape.

- [ ] **Step 19: Run the full frontend suite, typecheck, and lint**

Run `npx vitest run`, `npx tsc --noEmit`, and `npx next lint` from `frontend/`.
Expected: full suite green, typecheck clean, no new lint warnings beyond the pre-existing tracked set.

- [ ] **Step 20: Commit**

```bash
git add frontend/src/features/tasks/data/repository.ts frontend/src/features/tasks/data/repository.test.ts frontend/src/features/tasks/data/api-task-repository.ts frontend/src/features/tasks/data/api-task-repository.route-integration.test.ts frontend/src/features/tasks/api/tasks.ts frontend/src/app/api/tasks/[id]/commands/reorder/route.ts frontend/src/features/tasks/test-utils.tsx frontend/src/features/tasks/store.tsx frontend/src/features/tasks/store.test.tsx frontend/src/features/tasks/components/day-agenda.tsx frontend/src/features/tasks/components/day-agenda.test.tsx frontend/src/features/tasks/components/views/weekly-view.tsx
git commit -m "feat: wire the Reorder command into the frontend, removing setOrder (RF-005 phase 2)"
```

---

## After both tasks

Update `docs/refining/README.md`'s RF-005 row to record Reorder and the creation-order change as implemented, and flip its status from **In progress** to **Resolved** — this is the last open piece. Update `docs/refining/2026-08-06-transactional-task-commands.md` with a "Reorder command" section matching the existing "Nest command"/"Detach command"/etc. sections' structure. Not its own task above since it has no test cycle of its own — do it as part of wrapping up Task 3, or as a small final commit once both tasks are merged.

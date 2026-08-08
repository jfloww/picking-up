# Subtask Detail Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give subtasks their own `memo` field, and replace the Task Details drawer's click-to-inline-rename subtask interaction with a bottom-sheet "Subtask Detail" panel that edits the subtask's full title and notes, stacked over the drawer's footer.

**Architecture:** A backend `SubtaskSerializer.memo` field (truncate-on-write, matching the existing `id`/`title` pattern) makes `memo` a real, validated part of every subtask dict; `nest_task`/`promote_subtask` carry it across Task↔Subtask conversion. On the frontend, `Subtask.memo?: string` mirrors the backend, with an explicit wire-level `ApiSubtask` type in `mapping.ts` (subtask memo is `""` on the wire, never `null`, converted to `undefined` client-side — a deliberate divergence from `Task.memo`'s null-based convention, justified in the spec). A new standalone `SubtaskDetailPanel` component owns the sheet's UI; `TaskDetailDrawer` owns which subtask (if any) is open and renders the panel as an absolutely-positioned overlay covering its own footer. `DrawerSubtaskRow`'s title click switches from inline-rename to opening the panel.

**Tech Stack:** Django REST Framework (`backend/apps/tasks`), React function components with Tailwind (`frontend/src/features/tasks/components`), the existing custom store hook (`frontend/src/features/tasks/store.tsx`), Vitest (frontend), Django's `TestCase` (backend).

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-08-07-subtask-detail-panel-design.md`. Every rule below traces to a section there.
- `SUBTASK_MEMO_MAX_LENGTH = 2000`, truncated (never rejected) on write — same shape as `SUBTASK_ID_MAX_LENGTH`/`SUBTASK_TITLE_MAX_LENGTH` in `backend/apps/tasks/serializers.py`.
- Wire representation of a subtask's memo is always a string, defaulting to `""` — never `null`. This is intentionally different from `Task.memo` (which is nullable). See the spec's Data Model section for the full rationale.
- No database migration: `subtasks` is an untyped `JSONField`; adding a new optional key to the serializer needs no schema change.
- Out of scope: the non-drawer, inline task-expansion `SubtaskList` variant (`PlainSubtaskRow`) is untouched — its title has never been interactive.
- Backend tests run via: `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks -v 2` from `backend/`.
- Frontend tests run via `npx vitest run <path>` from `frontend/`.
- Every subtask edit (title, memo) commits immediately through a direct store action call — not buffered into `TaskDetailDrawer`'s `draft`/Done-button flow, matching the existing `onEditSubtaskTitle`/`onToggleSubtask`/`onRemoveSubtask` convention (only top-level task fields like memo/time/priority are buffered).

---

## File Structure

**Backend (`backend/apps/tasks/`):**
- `serializers.py` — add `SUBTASK_MEMO_MAX_LENGTH`; add `memo` field + `validate_memo` to `SubtaskSerializer`.
- `services.py` — `_nest_data_loss_fields` drops its `memo` check; `nest_task`'s appended subtask dict gains `"memo"`; `promote_subtask`'s created `Task(...)` gains `memo=`.
- `tests.py` — extend the subtask round-trip/truncation/boundary tests with `memo`; update the nest data-loss test (memo is no longer lossy); add promote-copies-memo tests.

**Frontend (`frontend/src/features/tasks/`):**
- `types.ts` — `Subtask` gains `memo?: string`; fix the now-stale `Task.subtasks` comment.
- `api/mapping.ts` — new `ApiSubtask` wire type; `ApiTask.subtasks: ApiSubtask[]`; explicit `toApiSubtask`/`fromApiSubtask` helpers used by `toApiPayload`/`fromApiPayload`.
- `api/mapping.test.ts` — extend fixtures with a subtask memo; add empty-string↔undefined conversion tests.
- `data/repository.ts` — `createLocalStorageRepository`'s `nestTask` drops `source.memo` from its `losesTaskOnlyData` check and carries memo onto the appended subtask; `promoteSubtask` carries memo onto the created task.
- `data/repository.test.ts` — add a nest-no-longer-lossy-for-memo test and a promote-carries-memo test.
- `test-utils.tsx` — `fakeRepository`'s `nestTask`/`promoteSubtask` get the same two memo-carrying additions (no data-loss check to touch there — the fake never modeled one).
- `store.tsx` — new `editSubtaskMemo` action (mirrors `editSubtaskTitle`'s shape, `setMemo`'s trim/clear-to-undefined convention); `convertTaskToSubtask`'s optimistic subtask dict and `promoteSubtaskToTask`'s optimistic `Task` both gain memo.
- `store.test.tsx` — add an `editSubtaskMemo` test and two memo-carrying tests (convert, promote).
- `components/task-item.tsx` — `TaskItemActions` gains `editSubtaskMemo`; `taskItemHandlers` gains `onEditSubtaskMemo`; `TaskItem`'s own now-unused `onEditSubtaskTitle` prop (only ever forwarded to `TaskDetailFields`, which no longer accepts it after Task 5) is removed.
- `components/subtask-detail-panel.tsx` (NEW) — the bottom-sheet panel: title input + notes textarea, commit-on-blur/Enter, Escape-to-cancel, close control.
- `components/subtask-detail-panel.test.tsx` (NEW) — its unit tests.
- `components/subtask-list.tsx` — `DrawerSubtaskRow` drops its inline-edit state entirely; its title button now calls a new `onOpen` prop. `SubtaskList`'s `onEditTitle` prop is removed (dead once `DrawerSubtaskRow` stops calling it — `PlainSubtaskRow` never did); a new optional `onOpenSubtask` prop is added and threaded to the drawer branch only.
- `components/task-detail-fields.tsx` — drops `onEditSubtaskTitle` (now unused); gains optional `onOpenSubtask`, threaded to `<SubtaskList>`.
- `components/task-detail-fields.test.tsx` — drop the now-removed `onEditSubtaskTitle` noop.
- `components/task-detail-drawer.tsx` — new `openSubtaskId` state (reset on task switch), new `onEditSubtaskMemo` prop, renders `<SubtaskDetailPanel>` as a sibling of `<footer>` when a subtask is open.
- `components/task-detail-drawer.test.tsx` — replace the 5 old inline-edit tests with panel-based equivalents; add `onEditSubtaskMemo` to `noopHandlers`.
- `components/primitives.test.tsx` — drop the now-invalid `onEditTitle` prop from its `SubtaskList` test.
- `components/task-item.test.tsx` — drop the now-stale `onEditSubtaskTitle` noop.

---

## Task 1: Backend — Subtask.memo field and Nest/Promote carry-over

**Files:**
- Modify: `backend/apps/tasks/serializers.py`
- Modify: `backend/apps/tasks/services.py`
- Test: `backend/apps/tasks/tests.py`

**Interfaces:**
- Produces: `SubtaskSerializer.memo` (wire key `"memo"`, always a string, `""` when absent); `SUBTASK_MEMO_MAX_LENGTH = 2000` (importable from `backend.apps.tasks.serializers`, matching the existing `SUBTASKS_MAX_COUNT` import in `tests.py`).
- Consumes: nothing new — reuses `Task.memo` (already on the model, nullable `TextField`).

- [ ] **Step 1: Write the failing serializer-level tests as HTTP-level tests**

In `backend/apps/tasks/tests.py`, update the import at the top of the file:

```python
from .serializers import EXCLUDED_DATES_MAX_COUNT, SUBTASK_MEMO_MAX_LENGTH, SUBTASKS_MAX_COUNT
```

Extend `test_create_round_trips_every_field_including_subtasks_and_repeat_source` (around line 95): change the `subtasks` override in the `make_task_payload(...)` call from

```python
                subtasks=[{"id": "s1", "title": "buy wood", "done": False}],
```

to

```python
                subtasks=[{"id": "s1", "title": "buy wood", "done": False, "memo": "oak, 2x4"}],
```

and change the assertion

```python
        self.assertEqual(stored.subtasks, [{"id": "s1", "title": "buy wood", "done": False}])
```

to

```python
        self.assertEqual(
            stored.subtasks,
            [{"id": "s1", "title": "buy wood", "done": False, "memo": "oak, 2x4"}],
        )
```

Add three new tests near the existing subtask-limits tests (around line 190, after `test_create_truncates_subtask_fields_that_commands_cannot_store_safely`):

```python
    def test_create_defaults_a_subtasks_missing_memo_to_an_empty_string(self):
        owner, client = auth_client("subtask-memo-default@example.com")
        task_id = str(uuid.uuid4())

        response = client.post(
            "/api/tasks/",
            make_task_payload(
                id=task_id,
                subtasks=[{"id": "s1", "title": "buy wood", "done": False}],
            ),
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        stored = Task.objects.get(id=task_id)
        self.assertEqual(stored.subtasks[0]["memo"], "")

    def test_create_truncates_an_overlength_subtask_memo(self):
        owner, client = auth_client("subtask-memo-limits@example.com")
        task_id = str(uuid.uuid4())

        response = client.post(
            "/api/tasks/",
            make_task_payload(
                id=task_id,
                subtasks=[
                    {"id": "s1", "title": "valid", "done": False, "memo": "m" * (SUBTASK_MEMO_MAX_LENGTH + 1)}
                ],
            ),
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        stored = Task.objects.get(id=task_id)
        self.assertEqual(len(stored.subtasks[0]["memo"]), SUBTASK_MEMO_MAX_LENGTH)
        self.assertEqual(stored.subtasks[0]["memo"], "m" * SUBTASK_MEMO_MAX_LENGTH)
```

Update `test_create_accepts_subtask_fields_at_exactly_the_length_boundary` (around line 191) to also exercise the memo boundary — replace its body with:

```python
    def test_create_accepts_subtask_fields_at_exactly_the_length_boundary(self):
        owner, client = auth_client("subtask-limits-boundary@example.com")
        task_id = str(uuid.uuid4())

        response = client.post(
            "/api/tasks/",
            make_task_payload(
                id=task_id,
                subtasks=[
                    {
                        "id": "a" * 255,
                        "title": "b" * 500,
                        "done": False,
                        "memo": "m" * SUBTASK_MEMO_MAX_LENGTH,
                    }
                ],
            ),
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        stored = Task.objects.get(id=task_id)
        self.assertEqual(stored.subtasks[0]["id"], "a" * 255)
        self.assertEqual(stored.subtasks[0]["title"], "b" * 500)
        self.assertEqual(stored.subtasks[0]["memo"], "m" * SUBTASK_MEMO_MAX_LENGTH)
```

Update `test_nest_requires_explicit_confirmation_for_server_detected_data_loss` (around line 1228) — this test currently creates its source with both `memo="important"` and `priority=True` and asserts both are reported as lost. Replace it with:

```python
    def test_nest_requires_explicit_confirmation_for_server_detected_data_loss(self):
        source = self.create_task(title="lossy", memo="important", priority=True)
        target = self.create_task(title="target")

        rejected = self.nest(source, target)
        accepted = self.nest(source, target, confirm_data_loss=True)

        self.assertEqual(rejected.status_code, 409)
        self.assertEqual(rejected.data["code"], "data_loss_confirmation_required")
        # memo is no longer lossy — it now travels onto the appended subtask
        # instead of being discarded, so only priority remains here.
        self.assertCountEqual(rejected.data["lost_fields"], ["priority"])
        self.assertEqual(accepted.status_code, 200, accepted.data)
        self.assertEqual(accepted.data["target"]["subtasks"][0]["memo"], "important")
```

Add two new tests near `test_promote_creates_one_task_and_updates_parent_atomically` (around line 1457):

```python
    def test_promote_copies_the_subtasks_memo_onto_the_new_task(self):
        parent = self.create_task(
            title="plan trip",
            subtasks=[{"id": "s1", "title": "book flights", "done": False, "memo": "window seat"}],
        )

        response = self.promote(parent, subtask_id="s1")

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["task"]["memo"], "window seat")

    def test_promote_leaves_the_new_tasks_memo_null_when_the_subtask_has_no_memo(self):
        parent = self.create_task(
            title="plan trip",
            subtasks=[{"id": "s1", "title": "book flights", "done": False}],
        )

        response = self.promote(parent, subtask_id="s1")

        self.assertEqual(response.status_code, 201, response.data)
        created = Task.objects.get(id=response.data["task"]["id"])
        self.assertIsNone(created.memo)
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks.tests -v 2` from `backend/`.
Expected: the new/updated tests fail — `KeyError: 'memo'` on subtask dicts, `ImportError` for `SUBTASK_MEMO_MAX_LENGTH`, and the updated data-loss test's `lost_fields` assertion mismatching (`["memo", "priority"]` still returned).

- [ ] **Step 3: Add `SUBTASK_MEMO_MAX_LENGTH` and `SubtaskSerializer.memo` to `serializers.py`**

In `backend/apps/tasks/serializers.py`, change the constant block (currently lines 15-16):

```python
SUBTASK_ID_MAX_LENGTH = 255
SUBTASK_TITLE_MAX_LENGTH = 500
SUBTASK_MEMO_MAX_LENGTH = 2000
```

Change `SubtaskSerializer` (currently lines 49-67):

```python
class SubtaskSerializer(serializers.Serializer):
    # Truncate rather than reject (RF-006 review finding): the generic Task
    # PUT always resends the whole subtasks array, so a hard `max_length`
    # rejection here would make any task holding one over-length subtask —
    # new or a pre-limit legacy row — permanently un-editable on every
    # future write, and would leave a legacy-localStorage task stuck
    # retrying the migration-upload loop forever. Truncating preserves the
    # underlying safety goal (nothing this API stores can later fail to
    # materialize into a Task via Promote) without that failure mode.
    # Existing DB rows get the same treatment once via migration 0014.
    id = serializers.CharField(allow_blank=False)
    title = serializers.CharField(allow_blank=False)
    done = serializers.BooleanField()
    # Unlike Task.memo (a nullable model column), this is a plain dict key
    # inside a JSONField list — there is no separate null/not-null column
    # state to preserve, so "no memo" is represented as "" rather than
    # None. This also means a legacy subtask dict with no "memo" key at
    # all reads back as "" once it passes through this serializer (DRF
    # applies `default` on both serialize and deserialize), with no
    # migration required.
    memo = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_id(self, value: str) -> str:
        return value[:SUBTASK_ID_MAX_LENGTH]

    def validate_title(self, value: str) -> str:
        return value[:SUBTASK_TITLE_MAX_LENGTH]

    def validate_memo(self, value: str) -> str:
        return value[:SUBTASK_MEMO_MAX_LENGTH]
```

- [ ] **Step 4: Update `_nest_data_loss_fields` and `nest_task` in `services.py`**

In `backend/apps/tasks/services.py`, `_nest_data_loss_fields` currently starts:

```python
def _nest_data_loss_fields(task: Task) -> list[str]:
    fields = []
    if task.memo:
        fields.append("memo")
    if task.completed_at:
```

Remove the `memo` check — it becomes:

```python
def _nest_data_loss_fields(task: Task) -> list[str]:
    fields = []
    if task.completed_at:
```

`nest_task`'s subtask-append (currently):

```python
    target.subtasks = [
        *target_subtasks,
        {"id": subtask_id, "title": source.title, "done": source.done},
    ]
```

becomes:

```python
    target.subtasks = [
        *target_subtasks,
        {
            "id": subtask_id,
            "title": source.title,
            "done": source.done,
            # source.memo is nullable (Task.memo); subtask memo is not — see
            # SubtaskSerializer.memo's comment for why "" is the "no memo"
            # value at this layer, not None.
            "memo": source.memo or "",
        },
    ]
```

- [ ] **Step 5: Update `promote_subtask` in `services.py`**

The `Task(...)` construction (currently):

```python
    task = Task(
        id=new_task_id,
        user=user,
        title=subtask_title,
        done=subtask["done"],
        completed_at=timezone.now() if subtask["done"] else None,
        scope_kind=parent.scope_kind,
        scope_value=parent.scope_value,
        bucket_category=parent.bucket_category,
        order=order,
    )
```

becomes:

```python
    task = Task(
        id=new_task_id,
        user=user,
        title=subtask_title,
        # Mirrors nest_task's inverse conversion: an empty subtask memo
        # becomes Task.memo's own "no memo" value (None), not "".
        memo=subtask.get("memo") or None,
        done=subtask["done"],
        completed_at=timezone.now() if subtask["done"] else None,
        scope_kind=parent.scope_kind,
        scope_value=parent.scope_value,
        bucket_category=parent.bucket_category,
        order=order,
    )
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks -v 2` from `backend/`.
Expected: PASS, full suite, no regressions.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/tasks/serializers.py backend/apps/tasks/services.py backend/apps/tasks/tests.py
git commit -m "feat: add Subtask.memo and carry it across Nest/Promote"
```

---

## Task 2: Frontend — Subtask.memo type and wire mapping

**Files:**
- Modify: `frontend/src/features/tasks/types.ts`
- Modify: `frontend/src/features/tasks/api/mapping.ts`
- Test: `frontend/src/features/tasks/api/mapping.test.ts`

**Interfaces:**
- Produces: `Subtask.memo?: string` (Task 1's `frontend/src/features/tasks/types.ts` counterpart); `ApiSubtask` (wire type, `memo: string` always present, never `null`); `toApiSubtask(subtask: Subtask): ApiSubtask`, `fromApiSubtask(subtask: ApiSubtask): Subtask` (not exported — internal to `mapping.ts`, used by `toApiPayload`/`fromApiPayload`).
- Consumes: nothing new.

- [ ] **Step 1: Write the failing mapping tests**

In `frontend/src/features/tasks/api/mapping.test.ts`, change `fullApiTask.subtasks` (currently line 21):

```typescript
  subtasks: [{ id: "s1", title: "buy wood", done: false }],
```

to

```typescript
  subtasks: [{ id: "s1", title: "buy wood", done: false, memo: "cedar plank" }],
```

and `fullTask.subtasks` (currently line 43) to the same shape:

```typescript
  subtasks: [{ id: "s1", title: "buy wood", done: false, memo: "cedar plank" }],
```

Add two new tests. Under `describe("fromApiPayload", ...)`, after the existing `"maps nulls to undefined..."` test:

```typescript
  it("maps a subtask's empty memo to undefined", () => {
    const payload: ApiTask = {
      ...fullApiTask,
      subtasks: [{ id: "s1", title: "buy wood", done: false, memo: "" }],
    };

    const task = fromApiPayload(payload);

    expect(task.subtasks?.[0].memo).toBeUndefined();
  });
```

Under `describe("toApiPayload", ...)`, after the existing `"maps undefined to null for optional fields..."` test:

```typescript
  it("maps a subtask's undefined memo to an empty string", () => {
    const task: Task = {
      ...fullTask,
      subtasks: [{ id: "s1", title: "buy wood", done: false }],
    };

    const payload = toApiPayload(task);

    expect(payload.subtasks[0].memo).toBe("");
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run src/features/tasks/api/mapping.test.ts` from `frontend/`.
Expected: FAIL — `fullApiTask`/`fullTask` fail to type-check (`memo` not assignable, since `Subtask`/`ApiTask.subtasks` don't have it yet), and the two new tests fail once compilation is fixed enough to run (`task.subtasks?.[0].memo` reads `undefined` either way today, so this specific assertion may pass by accident before Step 3 — the meaningful failure is the TypeScript compile error from the fixtures, which `vitest run` will surface as a failure).

- [ ] **Step 3: Add `Subtask.memo` to `types.ts`**

In `frontend/src/features/tasks/types.ts`, change:

```typescript
export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}
```

to:

```typescript
export interface Subtask {
  id: string;
  title: string;
  done: boolean;
  memo?: string;
}
```

Update the now-stale comment on `Task.subtasks` (currently `subtasks?: Subtask[]; // one level deep; no scope/memo/time of their own`) to:

```typescript
  subtasks?: Subtask[]; // one level deep; no scope/time of their own; may carry its own memo
```

- [ ] **Step 4: Add `ApiSubtask` and update `ApiTask` in `mapping.ts`**

In `frontend/src/features/tasks/api/mapping.ts`, after the `ScopeKind` type alias:

```typescript
export interface ApiSubtask {
  id: string;
  title: string;
  done: boolean;
  memo: string;
}
```

Change `ApiTask.subtasks` (currently `subtasks: Subtask[];`) to:

```typescript
  subtasks: ApiSubtask[];
```

- [ ] **Step 5: Add the per-subtask conversion helpers and wire them into `toApiPayload`/`fromApiPayload`**

Add, just above `toApiPayload`:

```typescript
function toApiSubtask(subtask: Subtask): ApiSubtask {
  return {
    id: subtask.id,
    title: subtask.title,
    done: subtask.done,
    memo: subtask.memo ?? "",
  };
}

function fromApiSubtask(subtask: ApiSubtask): Subtask {
  return {
    id: subtask.id,
    title: subtask.title,
    done: subtask.done,
    memo: subtask.memo ? subtask.memo : undefined,
  };
}
```

In `toApiPayload`, change:

```typescript
    subtasks: task.subtasks ?? [],
```

to:

```typescript
    subtasks: (task.subtasks ?? []).map(toApiSubtask),
```

In `fromApiPayload`, change:

```typescript
    subtasks: payload.subtasks.length > 0 ? payload.subtasks : undefined,
```

to:

```typescript
    subtasks: payload.subtasks.length > 0 ? payload.subtasks.map(fromApiSubtask) : undefined,
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/api/mapping.test.ts` from `frontend/`.
Expected: PASS.

- [ ] **Step 7: Run `tsc` to confirm no type errors elsewhere**

Run: `npx tsc --noEmit` from `frontend/`.
Expected: clean — `ApiTask.subtasks`'s type change should not affect any other file, since `subtasks` is only read through `fromApiPayload`/`toApiPayload` elsewhere in the codebase.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/tasks/types.ts frontend/src/features/tasks/api/mapping.ts frontend/src/features/tasks/api/mapping.test.ts
git commit -m "feat: add Subtask.memo to the frontend type and wire mapping"
```

---

## Task 3: Frontend — store/repository memo wiring

**Files:**
- Modify: `frontend/src/features/tasks/store.tsx`
- Modify: `frontend/src/features/tasks/test-utils.tsx`
- Modify: `frontend/src/features/tasks/data/repository.ts`
- Modify: `frontend/src/features/tasks/components/task-item.tsx`
- Test: `frontend/src/features/tasks/store.test.tsx`, `frontend/src/features/tasks/data/repository.test.ts`

**Interfaces:**
- Consumes: `Subtask.memo` (Task 2).
- Produces: `TasksContextValue.editSubtaskMemo(id: string, subtaskId: string, memo: string): void`; `TaskItemActions.editSubtaskMemo` and `taskItemHandlers(...)`'s returned `onEditSubtaskMemo: (subtaskId: string, memo: string) => void` — Task 5's `TaskDetailDrawer` wiring consumes this exact prop name.

- [ ] **Step 1: Write the failing store tests**

In `frontend/src/features/tasks/store.test.tsx`, add near the existing `"toggleSubtask flips one subtask; removeSubtask deletes it"` test:

```typescript
    it("editSubtaskMemo trims and clears a blank memo to undefined", async () => {
      const task = makeTask({
        id: "a",
        scope: { kind: "day", date: todayKey() },
        subtasks: [{ id: "s1", title: "one", done: false, memo: "old note" }],
      });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.editSubtaskMemo("a", "s1", "  new note  "));
      expect(result.current.tasks[0].subtasks).toEqual([
        { id: "s1", title: "one", done: false, memo: "new note" },
      ]);

      act(() => result.current.editSubtaskMemo("a", "s1", "   "));
      expect(result.current.tasks[0].subtasks?.[0].memo).toBeUndefined();
      await waitFor(() => expect(repo.tasks[0].subtasks?.[0].memo).toBeUndefined());
    });
```

Add near the existing `"convertTaskToSubtask moves a simple task into the target's subtasks and removes it"` test:

```typescript
    it("convertTaskToSubtask carries the source task's memo onto the new subtask", async () => {
      const source = makeTask({
        id: "s",
        title: "buy milk",
        memo: "2%",
        scope: { kind: "day", date: todayKey() },
      });
      const target = makeTask({ id: "t", title: "groceries", scope: { kind: "day", date: todayKey() } });
      const { result } = setup(fakeRepository([source, target]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.convertTaskToSubtask("s", "t", true));

      await waitFor(() =>
        expect(result.current.tasks.find((t) => t.id === "t")?.subtasks?.[0].memo).toBe("2%"),
      );
    });

    it("promoteSubtaskToTask carries the subtask's memo onto the new task", async () => {
      const parent = makeTask({
        id: "p",
        scope: { kind: "day", date: todayKey() },
        subtasks: [{ id: "s1", title: "book flights", done: false, memo: "window seat" }],
      });
      const { result } = setup(fakeRepository([parent]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      const created = result.current.promoteSubtaskToTask("p", "s1");

      expect(created?.memo).toBe("window seat");
    });
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run src/features/tasks/store.test.tsx` from `frontend/`.
Expected: `editSubtaskMemo` tests fail to compile (`result.current.editSubtaskMemo is not a function`); the memo-carrying tests fail their `waitFor`/`expect` (memo comes back `undefined`).

- [ ] **Step 3: Add `editSubtaskMemo` to `store.tsx`**

In `frontend/src/features/tasks/store.tsx`, add to the `TasksContextValue` interface, directly after `editSubtaskTitle` (currently line 261):

```typescript
  editSubtaskMemo: (id: string, subtaskId: string, memo: string) => void;
```

Add the implementation directly after `editSubtaskTitle`'s (currently ending at line 945):

```typescript
      editSubtaskMemo(id, subtaskId, memo) {
        const current = tasksRef.current.find((t) => t.id === id);
        if (!current?.subtasks) return;
        const task: Task = {
          ...current,
          subtasks: current.subtasks.map((s) =>
            s.id === subtaskId ? { ...s, memo: memo.trim() || undefined } : s,
          ),
        };
        persistUpdate(task);
      },
```

- [ ] **Step 4: Carry memo through `convertTaskToSubtask` and `promoteSubtaskToTask` in `store.tsx`**

`convertTaskToSubtask`'s optimistic subtask dict (currently):

```typescript
        const updatedTarget: Task = {
          ...target,
          subtasks: [
            ...(target.subtasks ?? []),
            { id: subtaskId, title: source.title, done: source.done },
          ],
        };
```

becomes:

```typescript
        const updatedTarget: Task = {
          ...target,
          subtasks: [
            ...(target.subtasks ?? []),
            { id: subtaskId, title: source.title, done: source.done, memo: source.memo },
          ],
        };
```

`promoteSubtaskToTask`'s optimistic `Task` construction (currently):

```typescript
        const task: Task = {
          id: crypto.randomUUID(),
          title: subtask.title,
          done: subtask.done,
          scope: parent.scope,
          order,
          createdAt: now,
          completedAt: subtask.done ? now : undefined,
          version: 1,
        };
```

becomes:

```typescript
        const task: Task = {
          id: crypto.randomUUID(),
          title: subtask.title,
          memo: subtask.memo,
          done: subtask.done,
          scope: parent.scope,
          order,
          createdAt: now,
          completedAt: subtask.done ? now : undefined,
          version: 1,
        };
```

- [ ] **Step 5: Mirror the memo carry-over in `test-utils.tsx`'s `fakeRepository`**

In `frontend/src/features/tasks/test-utils.tsx`, `nestTask`'s appended subtask dict (currently):

```typescript
        subtasks: [
          ...(target.subtasks ?? []),
          { id: command.subtaskId, title: source.title, done: source.done },
        ],
```

becomes:

```typescript
        subtasks: [
          ...(target.subtasks ?? []),
          { id: command.subtaskId, title: source.title, done: source.done, memo: source.memo },
        ],
```

`promoteSubtask`'s created `Task` (currently):

```typescript
      const task: Task = {
        id: command.newTaskId,
        title: subtask.title,
        done: subtask.done,
        scope: parent.scope,
        createdAt: now,
        completedAt: subtask.done ? now : undefined,
        order,
        version: 1,
      };
```

becomes:

```typescript
      const task: Task = {
        id: command.newTaskId,
        title: subtask.title,
        memo: subtask.memo,
        done: subtask.done,
        scope: parent.scope,
        createdAt: now,
        completedAt: subtask.done ? now : undefined,
        order,
        version: 1,
      };
```

- [ ] **Step 6: Run the store tests to verify they pass**

Run: `npx vitest run src/features/tasks/store.test.tsx` from `frontend/`.
Expected: PASS.

- [ ] **Step 7: Write the failing `createLocalStorageRepository` tests**

In `frontend/src/features/tasks/data/repository.test.ts`, add near the existing `"nests with one authoritative result and rejects a stale retry"` test:

```typescript
  it("nestTask no longer treats memo as lossy, and carries it onto the appended subtask", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const source = { ...task, id: "source", title: "buy milk", memo: "2%" };
    const target = { ...task, id: "target", title: "groceries", version: 1 };
    await repo.create(source);
    await repo.create(target);

    const result = await repo.nestTask({
      sourceId: source.id,
      targetId: target.id,
      sourceVersion: 1,
      targetVersion: 1,
      subtaskId: "subtask-id",
      confirmDataLoss: false,
    });

    expect(result.target.subtasks).toEqual([
      { id: "subtask-id", title: "buy milk", done: false, memo: "2%" },
    ]);
  });
```

Add near the existing `"promotes a subtask and increments only the existing parent's version"` test:

```typescript
  it("promoteSubtask carries the subtask's memo onto the new task", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const parent = {
      ...task,
      id: "parent",
      title: "trip",
      subtasks: [{ id: "subtask-id", title: "book flights", done: true, memo: "window seat" }],
    };
    await repo.create(parent);

    const result = await repo.promoteSubtask({
      parentId: parent.id,
      subtaskId: "subtask-id",
      parentVersion: 1,
      newTaskId: "promoted-id",
    });

    expect(result.task.memo).toBe("window seat");
  });
```

- [ ] **Step 8: Run the test to confirm the first one fails**

Run: `npx vitest run src/features/tasks/data/repository.test.ts` from `frontend/`.
Expected: `"nestTask no longer treats memo as lossy..."` fails with `Error: Nesting requires explicit data-loss confirmation.` (memo is still in `losesTaskOnlyData`); `"promoteSubtask carries the subtask's memo..."` fails (`result.task.memo` is `undefined`).

- [ ] **Step 9: Update `createLocalStorageRepository` in `repository.ts`**

`nestTask`'s `losesTaskOnlyData` check (currently):

```typescript
      const losesTaskOnlyData = Boolean(
        source.memo ||
          source.time ||
          source.durationMinutes ||
          source.priority ||
          source.dueDate ||
          source.background ||
          source.rolledFrom ||
          (source.excludedDates?.length ?? 0) > 0,
      );
```

becomes:

```typescript
      const losesTaskOnlyData = Boolean(
        source.time ||
          source.durationMinutes ||
          source.priority ||
          source.dueDate ||
          source.background ||
          source.rolledFrom ||
          (source.excludedDates?.length ?? 0) > 0,
      );
```

`nestTask`'s appended subtask dict (currently):

```typescript
        subtasks: [
          ...(target.subtasks ?? []),
          { id: command.subtaskId, title: source.title, done: source.done },
        ],
```

becomes:

```typescript
        subtasks: [
          ...(target.subtasks ?? []),
          { id: command.subtaskId, title: source.title, done: source.done, memo: source.memo },
        ],
```

`promoteSubtask`'s created `Task` (currently):

```typescript
      const task: Task = {
        id: command.newTaskId,
        title: subtask.title,
        done: subtask.done,
        scope: parent.scope,
        createdAt: now,
        completedAt: subtask.done ? now : undefined,
        order,
        version: 1,
      };
```

becomes:

```typescript
      const task: Task = {
        id: command.newTaskId,
        title: subtask.title,
        memo: subtask.memo,
        done: subtask.done,
        scope: parent.scope,
        createdAt: now,
        completedAt: subtask.done ? now : undefined,
        order,
        version: 1,
      };
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/data/repository.test.ts` from `frontend/`.
Expected: PASS, including the pre-existing `"nests with one authoritative result..."` and `"promotes a subtask..."` tests (their exact-equality/`toMatchObject` assertions tolerate the added `memo` key without changes, since neither test's base `task` fixture sets a memo, so the added key is `undefined` and `toEqual`/`toMatchObject` treat that as equivalent to absent).

- [ ] **Step 11: Wire `editSubtaskMemo` into `task-item.tsx`, and remove `onEditSubtaskTitle` now that Task 5 will delete its last consumer**

In `frontend/src/features/tasks/components/task-item.tsx`, add to the `TaskItemActions` interface, directly after `editSubtaskTitle` (currently line 34):

```typescript
  editSubtaskMemo: (id: string, subtaskId: string, memo: string) => void;
```

Add to `taskItemHandlers`'s returned object, directly after `onEditSubtaskTitle` (currently lines 85-86):

```typescript
    onEditSubtaskMemo: (subtaskId: string, memo: string) => actions.editSubtaskMemo(id, subtaskId, memo),
```

`TaskItem`'s own `onEditSubtaskTitle` prop exists only to forward to `<TaskDetailFields onEditSubtaskTitle={onEditSubtaskTitle} />` in its inline (non-drawer) expansion — Task 5 removes `TaskDetailFields`'s `onEditSubtaskTitle` prop entirely, so this becomes dead here too. Remove it from `TaskItem`'s destructured props (currently line 129: `onEditSubtaskTitle,`), from its prop type (currently line 151: `onEditSubtaskTitle: (subtaskId: string, title: string) => void;`), and delete the `onEditSubtaskTitle={onEditSubtaskTitle}` line from its `<TaskDetailFields>` call (currently line 436). Leave `taskItemHandlers`'s own `onEditSubtaskTitle` entry untouched — `TaskDetailDrawer` still needs it (Task 5 wires it directly to the new panel).

Callers that spread `taskItemHandlers(...)` onto `<TaskItem>` (e.g. `day-agenda.tsx`) pass an object that still contains `onEditSubtaskTitle` — this is harmless: TypeScript does not flag excess properties on a spread, only on object literals, so no other file needs to change.

- [ ] **Step 12: Run the full frontend suite for regressions**

Run: `npx vitest run` from `frontend/`.
Expected: no new failures. `task-item.test.tsx` and `primitives.test.tsx` both still spread an `onEditSubtaskTitle` noop into `<TaskItem>`/`noopHandlers` objects — harmless per the note above, so no changes are required there for this task (Task 5 touches `primitives.test.tsx` for an unrelated, required reason).

- [ ] **Step 13: Run `tsc` and `lint`**

Run: `npx tsc --noEmit` and `npx next lint` from `frontend/`.
Expected: clean.

- [ ] **Step 14: Commit**

```bash
git add frontend/src/features/tasks/store.tsx frontend/src/features/tasks/store.test.tsx frontend/src/features/tasks/test-utils.tsx frontend/src/features/tasks/data/repository.ts frontend/src/features/tasks/data/repository.test.ts frontend/src/features/tasks/components/task-item.tsx
git commit -m "feat: wire Subtask.memo through the store, repositories, and task-item handlers"
```

---

## Task 4: Frontend — SubtaskDetailPanel component

**Files:**
- Create: `frontend/src/features/tasks/components/subtask-detail-panel.tsx`
- Test: `frontend/src/features/tasks/components/subtask-detail-panel.test.tsx`

**Interfaces:**
- Consumes: `Subtask` (Task 2).
- Produces: `SubtaskDetailPanel({ subtask: Subtask; onClose: () => void; onTitleChange: (title: string) => void; onMemoChange: (memo: string) => void }): JSX.Element`. Task 5's `TaskDetailDrawer` renders this directly with these exact prop names.

This component is self-contained — it receives one subtask and three callbacks, and knows nothing about drawers, stores, or panels being open/closed elsewhere. It's tested here in isolation; Task 5 wires it into `TaskDetailDrawer`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/tasks/components/subtask-detail-panel.test.tsx`:

```typescript
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SubtaskDetailPanel } from "./subtask-detail-panel";

const subtask = { id: "s1", title: "buy wood", done: false, memo: "oak, 2x4" };

describe("SubtaskDetailPanel", () => {
  it("shows the subtask's full title and memo", () => {
    render(
      <SubtaskDetailPanel
        subtask={subtask}
        onClose={() => {}}
        onTitleChange={() => {}}
        onMemoChange={() => {}}
      />,
    );
    expect((screen.getByLabelText("Subtask title") as HTMLInputElement).value).toBe("buy wood");
    expect((screen.getByLabelText("Subtask notes") as HTMLTextAreaElement).value).toBe("oak, 2x4");
  });

  it("commits a changed title via onTitleChange on blur", () => {
    const onTitleChange = vi.fn();
    render(
      <SubtaskDetailPanel
        subtask={subtask}
        onClose={() => {}}
        onTitleChange={onTitleChange}
        onMemoChange={() => {}}
      />,
    );
    const input = screen.getByLabelText("Subtask title");
    fireEvent.change(input, { target: { value: "buy pine wood" } });
    fireEvent.blur(input);
    expect(onTitleChange).toHaveBeenCalledWith("buy pine wood");
  });

  it("commits a changed title via onTitleChange on Enter", () => {
    const onTitleChange = vi.fn();
    render(
      <SubtaskDetailPanel
        subtask={subtask}
        onClose={() => {}}
        onTitleChange={onTitleChange}
        onMemoChange={() => {}}
      />,
    );
    const input = screen.getByLabelText("Subtask title");
    fireEvent.change(input, { target: { value: "buy pine wood" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onTitleChange).toHaveBeenCalledWith("buy pine wood");
  });

  it("Escape restores the original title without calling onTitleChange", () => {
    const onTitleChange = vi.fn();
    render(
      <SubtaskDetailPanel
        subtask={subtask}
        onClose={() => {}}
        onTitleChange={onTitleChange}
        onMemoChange={() => {}}
      />,
    );
    const input = screen.getByLabelText("Subtask title") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "something else" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onTitleChange).not.toHaveBeenCalled();
    expect(input.value).toBe("buy wood");
  });

  it("does not call onTitleChange when the title is unchanged or blank", () => {
    const onTitleChange = vi.fn();
    render(
      <SubtaskDetailPanel
        subtask={subtask}
        onClose={() => {}}
        onTitleChange={onTitleChange}
        onMemoChange={() => {}}
      />,
    );
    const input = screen.getByLabelText("Subtask title");
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(onTitleChange).not.toHaveBeenCalled();
  });

  it("commits the memo via onMemoChange on blur, including clearing it to empty", () => {
    const onMemoChange = vi.fn();
    render(
      <SubtaskDetailPanel
        subtask={subtask}
        onClose={() => {}}
        onTitleChange={() => {}}
        onMemoChange={onMemoChange}
      />,
    );
    const notes = screen.getByLabelText("Subtask notes");
    fireEvent.change(notes, { target: { value: "cedar instead" } });
    fireEvent.blur(notes);
    expect(onMemoChange).toHaveBeenCalledWith("cedar instead");

    fireEvent.change(notes, { target: { value: "" } });
    fireEvent.blur(notes);
    expect(onMemoChange).toHaveBeenCalledWith("");
  });

  it("calls onClose when the close control is clicked", () => {
    const onClose = vi.fn();
    render(
      <SubtaskDetailPanel
        subtask={subtask}
        onClose={onClose}
        onTitleChange={() => {}}
        onMemoChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText("Close subtask detail"));
    expect(onClose).toHaveBeenCalled();
  });

  it("re-syncs its fields when a different subtask is passed in", () => {
    const { rerender } = render(
      <SubtaskDetailPanel
        subtask={subtask}
        onClose={() => {}}
        onTitleChange={() => {}}
        onMemoChange={() => {}}
      />,
    );
    rerender(
      <SubtaskDetailPanel
        subtask={{ id: "s2", title: "cut boards", done: false }}
        onClose={() => {}}
        onTitleChange={() => {}}
        onMemoChange={() => {}}
      />,
    );
    expect((screen.getByLabelText("Subtask title") as HTMLInputElement).value).toBe("cut boards");
    expect((screen.getByLabelText("Subtask notes") as HTMLTextAreaElement).value).toBe("");
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run src/features/tasks/components/subtask-detail-panel.test.tsx` from `frontend/`.
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement `SubtaskDetailPanel`**

Create `frontend/src/features/tasks/components/subtask-detail-panel.tsx`:

```typescript
"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import type { Subtask } from "../types";

// Rendered by TaskDetailDrawer as an absolutely-positioned sibling of its
// own <footer> — this component owns none of that positioning or the
// open/closed decision, only the sheet's own content and its slide-in.
// TaskDetailDrawer's `fixed` <aside> already establishes the containing
// block `inset-x-0 bottom-0` below needs.
export function SubtaskDetailPanel({
  subtask,
  onClose,
  onTitleChange,
  onMemoChange,
}: {
  subtask: Subtask;
  onClose: () => void;
  onTitleChange: (title: string) => void;
  onMemoChange: (memo: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState(subtask.title);
  const [memo, setMemo] = useState(subtask.memo ?? "");
  const memoRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setVisible(true);
  }, []);

  useEffect(() => {
    setTitle(subtask.title);
    setMemo(subtask.memo ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtask.id]);

  useEffect(() => {
    const el = memoRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [memo]);

  const commitTitle = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== subtask.title) onTitleChange(trimmed);
    else setTitle(subtask.title);
  };

  const commitMemo = () => {
    if (memo !== (subtask.memo ?? "")) onMemoChange(memo);
  };

  return (
    <div
      data-testid="subtask-detail-panel"
      className={cn(
        "absolute inset-x-0 bottom-0 z-10 flex max-h-[70%] flex-col rounded-t-xl border-t border-border bg-card shadow-[0_-8px_24px_rgba(0,0,0,0.25)] transition-transform duration-200 ease-out",
        visible ? "translate-y-0" : "translate-y-full",
      )}
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-5">
        <span className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">
          Subtask Detail
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close subtask detail"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTitle();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setTitle(subtask.title);
            }
          }}
          aria-label="Subtask title"
          className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-base font-semibold outline-none transition-colors duration-200 focus-visible:border-input focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <textarea
          ref={memoRef}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          onBlur={commitMemo}
          placeholder="Notes for this subtask…"
          rows={3}
          aria-label="Subtask notes"
          className="w-full resize-none overflow-hidden rounded-lg border border-input bg-muted/30 p-3 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/subtask-detail-panel.test.tsx` from `frontend/`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/tasks/components/subtask-detail-panel.tsx frontend/src/features/tasks/components/subtask-detail-panel.test.tsx
git commit -m "feat: add the standalone SubtaskDetailPanel component"
```

---

## Task 5: Frontend — wire the panel into the drawer

**Files:**
- Modify: `frontend/src/features/tasks/components/subtask-list.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-fields.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-drawer.tsx`
- Test: `frontend/src/features/tasks/components/task-detail-drawer.test.tsx`
- Test: `frontend/src/features/tasks/components/task-detail-fields.test.tsx`
- Test: `frontend/src/features/tasks/components/primitives.test.tsx`
- Test: `frontend/src/features/tasks/components/task-item.test.tsx`

**Interfaces:**
- Consumes: `SubtaskDetailPanel` (Task 4); `TaskItemActions.editSubtaskMemo`/`taskItemHandlers`'s `onEditSubtaskMemo` (Task 3).
- Produces: `TaskDetailDrawer`'s new `onEditSubtaskMemo: (subtaskId: string, memo: string) => void` prop (already supplied by `taskItemHandlers`'s spread in all 4 view files — `daily-view.tsx`, `weekly-view.tsx`, `monthly-view.tsx`, `bucket-list-view.tsx` — via Task 3, so none of those 4 files need direct changes).

- [ ] **Step 1: Write the failing `TaskDetailDrawer` tests**

In `frontend/src/features/tasks/components/task-detail-drawer.test.tsx`, add `onEditSubtaskMemo` to `noopHandlers` (currently after `onEditSubtaskTitle` at line 22):

```typescript
  onEditSubtaskMemo: (_id: string, _memo: string) => {},
```

Replace the five tests from `"clicking a subtask's title turns it into an editable input"` through `"does not call onEditSubtaskTitle when the title is unchanged"` (currently lines 555-607) with:

```typescript
    it("clicking a subtask's title opens the Subtask Detail panel instead of an inline editor", () => {
      render(<TaskDetailDrawer task={subtasksTask} {...noopHandlers} />);
      fireEvent.click(screen.getByText("buy wood"));
      expect(screen.getByTestId("subtask-detail-panel")).toBeTruthy();
      expect(screen.getByLabelText("Subtask title")).toBeTruthy();
      expect(screen.queryByLabelText("Edit buy wood")).toBeNull();
    });

    it("commits the new title via onEditSubtaskTitle on blur", () => {
      const onEditSubtaskTitle = vi.fn();
      render(
        <TaskDetailDrawer task={subtasksTask} {...noopHandlers} onEditSubtaskTitle={onEditSubtaskTitle} />,
      );
      fireEvent.click(screen.getByText("buy wood"));
      const input = screen.getByLabelText("Subtask title");
      fireEvent.change(input, { target: { value: "buy pine wood" } });
      fireEvent.blur(input);
      expect(onEditSubtaskTitle).toHaveBeenCalledWith("s2", "buy pine wood");
    });

    it("does not call onEditSubtaskTitle when the title is unchanged", () => {
      const onEditSubtaskTitle = vi.fn();
      render(
        <TaskDetailDrawer task={subtasksTask} {...noopHandlers} onEditSubtaskTitle={onEditSubtaskTitle} />,
      );
      fireEvent.click(screen.getByText("buy wood"));
      fireEvent.blur(screen.getByLabelText("Subtask title"));
      expect(onEditSubtaskTitle).not.toHaveBeenCalled();
    });

    it("commits notes via onEditSubtaskMemo on blur", () => {
      const onEditSubtaskMemo = vi.fn();
      render(
        <TaskDetailDrawer task={subtasksTask} {...noopHandlers} onEditSubtaskMemo={onEditSubtaskMemo} />,
      );
      fireEvent.click(screen.getByText("buy wood"));
      const notes = screen.getByLabelText("Subtask notes");
      fireEvent.change(notes, { target: { value: "oak, 2x4" } });
      fireEvent.blur(notes);
      expect(onEditSubtaskMemo).toHaveBeenCalledWith("s2", "oak, 2x4");
    });

    it("closes via its own close control", () => {
      render(<TaskDetailDrawer task={subtasksTask} {...noopHandlers} />);
      fireEvent.click(screen.getByText("buy wood"));
      fireEvent.click(screen.getByLabelText("Close subtask detail"));
      expect(screen.queryByTestId("subtask-detail-panel")).toBeNull();
    });

    it("clicking the same subtask row again closes the panel", () => {
      render(<TaskDetailDrawer task={subtasksTask} {...noopHandlers} />);
      fireEvent.click(screen.getByText("buy wood"));
      fireEvent.click(screen.getByText("buy wood"));
      expect(screen.queryByTestId("subtask-detail-panel")).toBeNull();
    });

    it("clicking a different subtask switches the panel instead of stacking a second one", () => {
      render(<TaskDetailDrawer task={subtasksTask} {...noopHandlers} />);
      fireEvent.click(screen.getByText("buy wood"));
      fireEvent.click(screen.getByText("cut boards"));
      expect(screen.getAllByTestId("subtask-detail-panel")).toHaveLength(1);
      expect((screen.getByLabelText("Subtask title") as HTMLInputElement).value).toBe("cut boards");
    });

    it("switching to a different task closes any open panel", () => {
      const { rerender } = render(<TaskDetailDrawer task={subtasksTask} {...noopHandlers} />);
      fireEvent.click(screen.getByText("buy wood"));
      expect(screen.getByTestId("subtask-detail-panel")).toBeTruthy();

      rerender(<TaskDetailDrawer task={makeTask({ id: "other", title: "unrelated" })} {...noopHandlers} />);
      expect(screen.queryByTestId("subtask-detail-panel")).toBeNull();
    });
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run src/features/tasks/components/task-detail-drawer.test.tsx` from `frontend/`.
Expected: FAIL — clicking "buy wood" still enters inline-rename, not the panel; no `subtask-detail-panel` test id exists; `onEditSubtaskMemo` prop doesn't exist on `TaskDetailDrawer`.

- [ ] **Step 3: Remove inline editing from `DrawerSubtaskRow` and add `onOpen`**

In `frontend/src/features/tasks/components/subtask-list.tsx`, `DrawerSubtaskRow`'s signature (currently):

```typescript
function DrawerSubtaskRow({
  subtask,
  onToggle,
  onRemove,
  onEditTitle,
  onPromote,
  animationClass,
}: {
  subtask: Subtask;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onEditTitle: (subtaskId: string, title: string) => void;
  onPromote?: (subtaskId: string) => void;
  animationClass?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(subtask.title);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = () => {
    setValue(subtask.title);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== subtask.title) onEditTitle(subtask.id, trimmed);
  };

  const cancel = () => {
    setValue(subtask.title);
    setEditing(false);
  };

  const handleRemove = () => {
```

becomes:

```typescript
function DrawerSubtaskRow({
  subtask,
  onToggle,
  onRemove,
  onOpen,
  onPromote,
  animationClass,
}: {
  subtask: Subtask;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onOpen?: (subtaskId: string) => void;
  onPromote?: (subtaskId: string) => void;
  animationClass?: string;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleRemove = () => {
```

Its JSX (currently the `editing ? <input> : <button>` block):

```typescript
      {editing ? (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          aria-label={`Edit ${subtask.title}`}
          autoFocus
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-1 text-sm outline-none transition-colors duration-200 focus-visible:border-input focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      ) : (
        <button
          type="button"
          onClick={startEditing}
          className={cn(
            "min-w-0 flex-1 truncate rounded-md px-1 py-1 text-left text-sm text-foreground/80 outline-none transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
            subtask.done && "text-muted-foreground line-through hover:text-muted-foreground",
          )}
        >
          {subtask.title}
        </button>
      )}
```

becomes:

```typescript
      <button
        type="button"
        onClick={() => onOpen?.(subtask.id)}
        className={cn(
          "min-w-0 flex-1 truncate rounded-md px-1 py-1 text-left text-sm text-foreground/80 outline-none transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          subtask.done && "text-muted-foreground line-through hover:text-muted-foreground",
        )}
      >
        {subtask.title}
      </button>
```

Since `useRef` is no longer used by this component (only `useState` remains), change the `react` import at the top of the file from `import { useRef, useState } from "react";` to `import { useState } from "react";`.

- [ ] **Step 4: Update `DrawerSubtaskList` and `SubtaskList` to thread `onOpenSubtask` instead of `onEditTitle`**

`DrawerSubtaskList`'s signature (currently):

```typescript
function DrawerSubtaskList({
  subtasks,
  renderStates,
  onAdd,
  onToggle,
  onRemove,
  onEditTitle,
  onPromote,
}: {
  subtasks: Subtask[];
  renderStates: Map<string, SubtaskRenderState>;
  onAdd: (title: string) => void;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onEditTitle: (subtaskId: string, title: string) => void;
  onPromote?: (subtaskId: string) => void;
}) {
```

becomes:

```typescript
function DrawerSubtaskList({
  subtasks,
  renderStates,
  onAdd,
  onToggle,
  onRemove,
  onOpenSubtask,
  onPromote,
}: {
  subtasks: Subtask[];
  renderStates: Map<string, SubtaskRenderState>;
  onAdd: (title: string) => void;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onOpenSubtask?: (subtaskId: string) => void;
  onPromote?: (subtaskId: string) => void;
}) {
```

Its `<DrawerSubtaskRow>` call (currently):

```typescript
            <DrawerSubtaskRow
              key={s.id}
              subtask={s}
              onToggle={onToggle}
              onRemove={onRemove}
              onEditTitle={onEditTitle}
              onPromote={onPromote}
              animationClass={state?.enterAnimationClass ?? state?.sectionAnimationClass}
            />
```

becomes:

```typescript
            <DrawerSubtaskRow
              key={s.id}
              subtask={s}
              onToggle={onToggle}
              onRemove={onRemove}
              onOpen={onOpenSubtask}
              onPromote={onPromote}
              animationClass={state?.enterAnimationClass ?? state?.sectionAnimationClass}
            />
```

`SubtaskList`'s exported signature (currently):

```typescript
export function SubtaskList({
  subtasks,
  onAdd,
  onToggle,
  onRemove,
  onEditTitle,
  onPromote,
  drawer = false,
}: {
  subtasks: Subtask[];
  onAdd: (title: string) => void;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onEditTitle: (subtaskId: string, title: string) => void;
  onPromote?: (subtaskId: string) => void;
  drawer?: boolean;
}) {
```

becomes:

```typescript
export function SubtaskList({
  subtasks,
  onAdd,
  onToggle,
  onRemove,
  onOpenSubtask,
  onPromote,
  drawer = false,
}: {
  subtasks: Subtask[];
  onAdd: (title: string) => void;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onOpenSubtask?: (subtaskId: string) => void;
  onPromote?: (subtaskId: string) => void;
  drawer?: boolean;
}) {
```

Its `<DrawerSubtaskList>` call (currently passing `onEditTitle={onEditTitle}`) becomes `onOpenSubtask={onOpenSubtask}`:

```typescript
    return (
      <DrawerSubtaskList
        subtasks={subtasks}
        renderStates={renderStates}
        onAdd={onAdd}
        onToggle={onToggle}
        onRemove={onRemove}
        onOpenSubtask={onOpenSubtask}
        onPromote={onPromote}
      />
    );
```

`PlainSubtaskRow`/the non-drawer return branch are untouched — they never received `onEditTitle` and don't receive `onOpenSubtask` either.

- [ ] **Step 5: Update `TaskDetailFields`**

In `frontend/src/features/tasks/components/task-detail-fields.tsx`, remove `onEditSubtaskTitle` from the destructured props (currently line 30) and from the prop type (currently line 53: `onEditSubtaskTitle: (subtaskId: string, title: string) => void;`). Add `onOpenSubtask?: (subtaskId: string) => void;` to the prop type, placed directly where `onEditSubtaskTitle` was, and add `onOpenSubtask` to the destructured props in the same spot.

Change the `<SubtaskList>` call (currently):

```typescript
      <SubtaskList
        subtasks={subtasks}
        onAdd={onAddSubtask}
        onToggle={onToggleSubtask}
        onRemove={onRemoveSubtask}
        onEditTitle={onEditSubtaskTitle}
        onPromote={onPromoteSubtask}
        drawer={drawer}
      />
```

to:

```typescript
      <SubtaskList
        subtasks={subtasks}
        onAdd={onAddSubtask}
        onToggle={onToggleSubtask}
        onRemove={onRemoveSubtask}
        onOpenSubtask={onOpenSubtask}
        onPromote={onPromoteSubtask}
        drawer={drawer}
      />
```

- [ ] **Step 6: Update `task-detail-fields.test.tsx`**

In `frontend/src/features/tasks/components/task-detail-fields.test.tsx`, remove the now-invalid `onEditSubtaskTitle: (_id: string, _title: string) => {},` line (currently line 19) from `noopHandlers`.

- [ ] **Step 7: Update `TaskDetailDrawer`**

In `frontend/src/features/tasks/components/task-detail-drawer.tsx`, add the import:

```typescript
import { SubtaskDetailPanel } from "./subtask-detail-panel";
```

Add `onEditSubtaskMemo` to the prop destructuring, directly after `onEditSubtaskTitle` (currently line 67), and to the prop type, directly after `onEditSubtaskTitle`'s type (currently line 89):

```typescript
  onEditSubtaskMemo: (subtaskId: string, memo: string) => void,
```

(destructuring position) and

```typescript
  onEditSubtaskMemo: (subtaskId: string, memo: string) => void;
```

(type position).

Add state, directly after the existing `promoteToast` state declaration:

```typescript
  const [openSubtaskId, setOpenSubtaskId] = useState<string | null>(null);
```

In the existing task-switch effect (currently):

```typescript
  useEffect(() => {
    setDraft(draftFromTask(task, bucketCategories));
    setConfirmingDelete(false);
    setPromoteToast(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);
```

add `setOpenSubtaskId(null);`:

```typescript
  useEffect(() => {
    setDraft(draftFromTask(task, bucketCategories));
    setConfirmingDelete(false);
    setPromoteToast(null);
    setOpenSubtaskId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);
```

Add, directly after the `draftTask` construction and before the `return (`:

```typescript
  const openSubtask = task.subtasks?.find((s) => s.id === openSubtaskId);
```

Change the `<TaskDetailFields>` call — replace `onEditSubtaskTitle={onEditSubtaskTitle}`... actually `TaskDetailFields` no longer takes that prop (Step 5), so there is nothing to replace there; instead ADD `onOpenSubtask`:

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
          onOpenSubtask={(subtaskId) =>
            setOpenSubtaskId((current) => (current === subtaskId ? null : subtaskId))
          }
          onPromoteSubtask={handlePromoteSubtask}
          bucketCategories={bucketCategories.map((c) => c.name)}
          bucketCategoryName={draftCategory}
          onCategoryChange={(category) => setDraft((d) => ({ ...d, category }))}
          showTime={task.scope.kind !== "bucket"}
          showDelete={false}
          variant="drawer"
        />
```

(This removes the old `onEditSubtaskTitle={onEditSubtaskTitle}` line and adds `onOpenSubtask` in its place — every other prop is unchanged.)

Finally, render the panel as a sibling of `<footer>`, after it closes and before `{promoteToast && ...}`:

```typescript
      </footer>
      {openSubtask && (
        <SubtaskDetailPanel
          subtask={openSubtask}
          onClose={() => setOpenSubtaskId(null)}
          onTitleChange={(title) => onEditSubtaskTitle(openSubtask.id, title)}
          onMemoChange={(memo) => onEditSubtaskMemo(openSubtask.id, memo)}
        />
      )}
      {promoteToast && (
```

- [ ] **Step 8: Run the `task-detail-drawer.test.tsx` tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/task-detail-drawer.test.tsx` from `frontend/`.
Expected: PASS.

- [ ] **Step 9: Fix `primitives.test.tsx`**

In `frontend/src/features/tasks/components/primitives.test.tsx`, the `"SubtaskList" > "wires toggle, remove, and add"` test currently passes `onEditTitle={() => {}}` to `<SubtaskList>` (currently line 616). Since `SubtaskList` no longer has an `onEditTitle` prop, delete that line entirely — the test doesn't exercise editing/opening, so no replacement prop is needed.

- [ ] **Step 10: Clean up the now-stale `onEditSubtaskTitle` noop in `task-item.test.tsx`**

In `frontend/src/features/tasks/components/task-item.test.tsx`, remove the `onEditSubtaskTitle: () => {},` line (currently line 21) from `noopHandlers` — `TaskItem` no longer declares this prop (Task 3, Step 11).

- [ ] **Step 11: Run the full frontend suite**

Run: `npx vitest run` from `frontend/`.
Expected: PASS, no regressions.

- [ ] **Step 12: Run `tsc` and `lint`**

Run: `npx tsc --noEmit` and `npx next lint` from `frontend/`.
Expected: clean.

- [ ] **Step 13: Manually verify in the browser**

Start the dev server (`npm run dev` from `frontend/`, backend running per the usual local setup), open a task with subtasks in any view, click a subtask's title, and confirm: the panel slides up from the bottom covering the drawer's footer; the title and notes are editable and persist after closing and reopening the task; clicking the row again or the panel's close button dismisses it; clicking a different subtask switches the panel instead of stacking. Report any visual issues found — this plan's tests cover behavior, not the actual slide-in animation or covering-the-footer visual claim from the spec.

- [ ] **Step 14: Commit**

```bash
git add frontend/src/features/tasks/components/subtask-list.tsx frontend/src/features/tasks/components/task-detail-fields.tsx frontend/src/features/tasks/components/task-detail-fields.test.tsx frontend/src/features/tasks/components/task-detail-drawer.tsx frontend/src/features/tasks/components/task-detail-drawer.test.tsx frontend/src/features/tasks/components/primitives.test.tsx frontend/src/features/tasks/components/task-item.test.tsx
git commit -m "feat: open the Subtask Detail panel from a subtask's title instead of inline rename"
```

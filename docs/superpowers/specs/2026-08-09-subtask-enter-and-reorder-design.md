# Subtask Detail Enter-to-Close and Subtask Reordering — Design

## Goal

Two small, independent UX additions to subtask editing:
1. Pressing Enter in the Subtask Detail panel's title field commits the
   edit **and closes the panel** (today it only commits).
2. Subtasks can be reordered via a drag handle, within the Drawer variant
   of the subtask list.

## Background / current state

- `backend/apps/tasks/models.py:89` — `Task.subtasks` is a `JSONField`,
  a list of dicts embedded directly in the Task row. There is no separate
  `Subtask` model, no per-subtask `order` or `version` field.
- `backend/apps/tasks/serializers.py`'s `SubtaskSerializer` (plain
  `serializers.Serializer`, not `ModelSerializer`) round-trips the array
  in place — array position is already implicitly "the order," it has
  just never been exposed as a reorder interaction.
- Every existing subtask edit (add/toggle/rename/remove, in
  `frontend/src/features/tasks/store.tsx`'s `addSubtask`/`toggleSubtask`/
  `removeSubtask`/`editSubtaskTitle`) rebuilds the whole `subtasks` array
  client-side and sends it via a full-Task PATCH (`persistUpdate` →
  `repo.update(rebased)`), guarded by the Task's own `version` field for
  optimistic concurrency (bumped in `serializers.py`'s `update()`).
- `frontend/src/features/tasks/components/subtask-detail-panel.tsx:113-132`
  — the title `<textarea>`'s `onKeyDown` already calls `commitTitle()` on
  Enter (`e.preventDefault()`, no newline inserted) and reverts the title
  on Escape (`stopPropagation()`'d so it doesn't also trigger the parent
  drawer's Escape-close). The memo/notes `<textarea>` has no `onKeyDown`
  at all — Enter inserts a newline there, unchanged by this spec.
- Top-level Tasks already have drag-to-reorder
  (`frontend/src/features/tasks/components/use-drag-to-reorder.ts`), used
  in `day-agenda.tsx`/`scope-tasks.tsx` — but that system exists to solve
  a different problem: many independent DB rows sharing one `order`
  column, reordered via a dedicated `POST /commands/reorder/` endpoint
  with server-side fractional-index math
  (`backend/apps/tasks/services.py`'s `reorder_task`/`_order_between`) so
  that moving one task never requires rewriting its siblings. That
  problem doesn't exist for subtasks — the entire `subtasks` array is
  already rewritten on every single edit today, so there is nothing to
  save by avoiding a full-array write.

## Design

### 1. Enter commits and closes the Subtask Detail panel

In `subtask-detail-panel.tsx`'s title field `onKeyDown`, after
`commitTitle()` on Enter, also call `onClose` (`() => void`, line 33 of
the panel's props — the same callback already wired to the close button's
`onClick` at line 100). Escape is unchanged: it still only reverts the
title and does not close the panel. Enter and Escape stay semantically
distinct — "save and leave" vs. "cancel, stay open."

The memo/notes field is untouched by this spec (multi-line, Enter must
keep inserting a newline).

### 2. Subtask reordering via drag handle (Drawer variant only)

**Scope:** `DrawerSubtaskRow` in
`frontend/src/features/tasks/components/subtask-list.tsx` (used from
`task-detail-drawer.tsx`'s `variant="drawer"`). The plain variant
(`PlainSubtaskRow`, reached only from `task-item.tsx`'s inline
in-list expansion) is explicitly **out of scope** for this pass — smaller,
more space-constrained context; a natural follow-up if wanted later, not
included here.

**Visual:** add a `GripVertical` icon (`lucide-react`, `size-3.5`, same
icon already used for task-level reordering in `scope-tasks.tsx` and
`day-agenda.tsx`) as the leftmost element of `DrawerSubtaskRow`, before
the `Checkbox`. This adds a new left-edge click/drag target; existing
elements (checkbox, title button, promote button, remove button) are
unaffected and keep their current click behavior.

**Interaction:** a new hook, `useDragToReorderSubtasks` (naming TBD at
implementation time — mirror whatever convention reads best next to
`useDragToReorder`), adapted from `use-drag-to-reorder.ts`'s pointer-event
mechanics:
- Pointer capture on handle `pointerdown`.
- 10px move threshold before a drag is recognized (matches the existing
  task-drag feel).
- Midpoint-of-row hit-testing against sibling subtask row refs to
  determine the new insertion index, same technique as the existing hook.
- Drop outside the subtask list's container cancels the drag (no
  reorder), matching the existing containment-check behavior.
- No keyboard-operable path in this pass (matches today's task-reorder,
  which is pointer-only too — not a regression, just not extended here).

**Persistence:** unlike task reorder, there is no dedicated command
endpoint and no fractional index. On drop:
1. Splice the in-memory `subtasks` array into its new order (array
   position **is** the order — no separate order field to update).
2. Call the same store path every other subtask edit already uses
   (`persistUpdate` → full-Task PATCH via `repo.update`).
3. The Task's existing `version` field guards this PATCH exactly as it
   guards every other subtask edit today — a concurrent edit from another
   session/tab produces the same conflict handling already in place for
   add/rename/toggle/remove. No new concurrency logic.

A no-op drag (dropped back in its original position) must not trigger a
PATCH — mirrors `day-agenda.tsx`'s existing `handleReorder` no-op check
before calling into the reorder action for tasks.

## Testing

- `subtask-detail-panel.test.tsx`: extend with a case asserting Enter in
  the title field both commits the edit and closes the panel (spy/mock
  on whatever close callback is used); confirm Escape still does not
  close.
- New test file for `useDragToReorderSubtasks` (or wherever the hook's
  logic lives), mirroring `use-drag-to-reorder.test.tsx`'s coverage:
  drag past a sibling reorders the array correctly, drag outside the
  list container cancels, a sub-threshold/no-op drag doesn't call
  `persistUpdate`.
- No backend test changes expected — `SubtaskSerializer`/`Task.subtasks`
  already round-trip array order verbatim (confirmed in research above);
  this feature is purely a new client-side interaction over an existing,
  already-correct persistence path.

## Out of scope

- Reordering in the plain/inline variant (`task-item.tsx`).
- Keyboard-operable reordering (grab/move/drop via Enter + arrow keys) —
  the user's initial framing raised this as a possible interpretation of
  "handle," but the clarified ask is a visual drag handle, not a keyboard
  interaction. Worth a future accessibility pass, not this one.
- Any backend change — confirmed unnecessary given the embedded-JSON data
  model.

## Open questions

None outstanding — all resolved during brainstorming (Escape-does-not-close,
drag-handle approach over full command-endpoint mirroring or up/down
buttons, Drawer-variant-only scope).

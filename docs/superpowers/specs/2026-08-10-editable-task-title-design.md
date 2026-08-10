# Design: Editable Task Title in the Task Details Drawer

- Date: 2026-08-10
- Status: Approved by owner, not yet implemented

## Problem

The Task Details drawer (`frontend/src/features/tasks/components/
task-detail-drawer.tsx`) lets you edit a task's memo, time, priority,
background, due date, repeat schedule, and subtasks — every field except
the task's own title, which renders as a plain, non-interactive
`<h2>{task.title}</h2>` (currently lines 280-287). Nothing in the app can
rename a task after creation: no store action exists (`title` only
appears as an `addTask` creation parameter and in subtask-editing
contexts), and no other UI surface offers a rename affordance either. The
gap became noticeable specifically because subtasks just gained a full,
editable detail panel (title + notes) — the natural next place a user
tries the same interaction is the parent task's own title, and it does
nothing.

The backend already accepts `title` on the generic task `PUT` (the same
endpoint `setMemo`/`setPriority`/etc. already use) — this is a
frontend-only gap, no backend or API changes needed.

## Scope

In scope: a `setTitle` store action; making the drawer's title heading an
editable field, buffered into the drawer's existing `draft` state and
committed only on Done, matching the drawer's dominant convention (memo,
time, priority, background, due date, and repeat all work this way today
— only subtasks commit immediately, and that's a deliberate, separate
convention this feature does not need to match).

Out of scope: editing a task's title anywhere else in the app (task list
rows, subtask promotion, etc.) — none of those currently support renaming
either, and none were asked for. Revisit as a separate spec if wanted
later.

## Design

### Store action

`frontend/src/features/tasks/store.tsx` gains `setTitle(id: string, title:
string): void`, placed next to the existing `setMemo`/`setPriority`
actions and following `setMemo`'s exact shape:

```typescript
setTitle(id, title) {
  const current = tasksRef.current.find((t) => t.id === id);
  if (!current) return;
  const trimmed = title.trim();
  if (!trimmed) return;
  const task: Task = { ...current, title: trimmed };
  persistUpdate(task);
},
```

The blank-guard (`if (!trimmed) return`) matches `editSubtaskTitle`'s own
guard — a task title, like a subtask title, must never become empty.
Unlike `setMemo` (where an empty result clears the field to `undefined`,
since "no memo" is a valid state), an empty title is not a valid state,
so the whole update is silently skipped rather than substituting a
placeholder.

### Drawer field

The `<h2>` at `task-detail-drawer.tsx:280-287` is replaced with an
always-visible, auto-growing `<textarea>`, styled to read as the same
heading (matching font-size/weight/line-height, `border-transparent`
until focused) — reusing the exact auto-grow technique already
established this session in `SubtaskDetailPanel`'s title field and the
drawer's own memo textarea (a `useEffect` setting `el.style.height =
"auto"` then `${el.scrollHeight}px` on value change).

This is an always-editable field, not a click-to-reveal one — the
subtask panel deliberately moved *away* from click-to-edit toward a
dedicated panel specifically because it needed to combine title and notes
in one place; the main task's title doesn't have that problem (its memo
already lives in its own section elsewhere in this same drawer), so a
plain always-editable textarea is simpler and avoids reintroducing the
inline-edit interaction the subtask work just retired. It also avoids the
single-line-clipping bug fixed for subtask titles earlier this session —
a task title can be just as long.

### Draft state and commit timing

The `Draft` interface (`task-detail-drawer.tsx`) gains a `title: string`
field, initialized from `task.title` in `draftFromTask` alongside the
other fields it already seeds.

- **Typing** updates `draft.title` only — no store call.
- **Enter** is prevented from inserting a newline (`e.preventDefault()`
  in the textarea's `onKeyDown`) since a title stays one logical line
  even once it visually wraps, but does **not** submit the drawer or
  call `handleDone` — no other buffered field in this drawer auto-submits
  on Enter (the memo textarea, for instance, just accepts it as a normal
  keystroke with no special handling), and title shouldn't be the
  exception.
- **Escape** is not specially handled at the field level. It falls
  through to the drawer's existing document-level Escape ladder exactly
  like memo/time/priority do today: closing the drawer without clicking
  Done discards the whole buffered draft, title included.
- **Done** (`handleDone`) gains one more guarded call, in the same style
  as the existing ones:
  ```typescript
  if (draft.title !== task.title) onTitleChange(draft.title);
  ```
  A blank `draft.title` is not specially handled here — `setTitle`'s own
  guard silently no-ops on a blank value, so clearing the title and
  clicking Done simply leaves the title unchanged, the same way it would
  if `onTitleChange` were never called at all. No new validation-error UI
  is introduced.

### Wiring

`TaskDetailDrawer` gains a new required prop, `onTitleChange: (title:
string) => void`, following the exact shape of `onMemoChange` next to it
in both the prop list and the component's destructuring.

`frontend/src/features/tasks/components/task-item.tsx`'s
`taskItemHandlers` (already the single place that maps store actions to
drawer props for all 4 calendar views) gains:

```typescript
onTitleChange: (title: string) => actions.setTitle(id, title),
```

placed next to the existing `onMemoChange` line, so all 4 view files
(`daily-view.tsx`, `weekly-view.tsx`, `monthly-view.tsx`,
`bucket-list-view.tsx`) pick it up automatically via their existing
`{...taskItemHandlers(...)}` spread — none of them need direct changes.

## Testing

- `store.test.tsx`: `setTitle` trims and commits a changed title; a blank
  title is a no-op (both the optimistic state and the persisted repo
  state stay unchanged).
- `task-detail-drawer.test.tsx`: typing a new title and clicking Done
  calls `onTitleChange` with the trimmed value; clicking Cancel (or
  pressing Escape) after typing a new title does *not* call
  `onTitleChange` and leaves the original title showing next time the
  drawer opens; Enter inside the title field does not close the drawer
  and does not insert a newline into the value; an unchanged title does
  not call `onTitleChange` at all.

## Open items intentionally deferred

- No UI anywhere else in the app gains title-editing as part of this
  work (task list rows, etc.) — flagged as out of scope above, not
  forgotten.

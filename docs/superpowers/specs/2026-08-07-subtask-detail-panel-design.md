# Design: Subtask Detail Panel

- Date: 2026-08-07
- Status: Approved by owner, not yet implemented

## Problem

Clicking a subtask's title in the Task Details drawer switches its row into
inline rename (a single-line `<input>`, `DrawerSubtaskRow`'s `editing` state
in `frontend/src/features/tasks/components/subtask-list.tsx`). Subtasks
currently carry only `id`, `title`, `done` (`frontend/src/features/tasks/
types.ts`) — there is nowhere to see or write anything beyond the title, and
a long title still truncates in the row (`truncate` on the title button).

The owner wants clicking a subtask to open a dedicated detail view instead —
matching how clicking a task opens its own Task Details drawer — where the
full title is visible and editable, and where the subtask can carry its own
notes. Notes is a genuinely new field: no subtask has ever stored anything
beyond title/done.

## Scope

In scope: a `memo` field on `Subtask` (frontend type, backend `subtasks`
JSONField entries, `SubtaskSerializer` validation); a "Subtask Detail" sheet
that opens from a subtask's title click, replacing today's inline rename;
carrying `memo` across Promote and Nest now that subtasks can hold it.

Out of scope: the non-drawer, inline task-expansion view (`task-item.tsx`'s
use of `SubtaskList` with `drawer` unset — no promote button, denser rows).
It has no drawer to stack a sheet on top of, so it keeps today's
inline-rename-on-click behavior unchanged. The subtask row's own checkbox,
promote, and delete controls are untouched — the sheet only handles title
and notes.

## Layout

A shorter panel slides up from the bottom of the Task Details drawer,
covering its lower portion — including the drawer's own Cancel/Done/Delete
footer — while open. It has its own small header with a close (✕) control;
clicking it, or clicking the subtask row again, slides the sheet back down
and restores the drawer's normal footer. This was chosen (via a visual
mockup comparison) over two alternatives: swapping the drawer's own content
in place with a back arrow, and opening a fully separate second drawer
stacked further out. The bottom-sheet approach was picked specifically
because it reads as "coming from the bottom," matching how the owner
described the interaction, and keeps the parent task's own content visible
above it while the subtask is being edited.

## Content

- Full, untruncated subtask title — a text input, editable in place (same
  commit-on-blur / Enter-to-commit / Escape-to-cancel behavior
  `DrawerSubtaskRow`'s current inline editor already has, just relocated
  into the sheet).
- A new **notes** field: an auto-expanding textarea, matching the parent
  task's own notes section in the drawer (`TaskDetailFields`'s
  `notesSection`, which grows via `el.style.height = el.scrollHeight` on
  input).

## Data model

- `Subtask` (`frontend/src/features/tasks/types.ts`) gains an optional
  `memo?: string`.
- Backend: `subtasks` is a `JSONField` of plain dicts; `SubtaskSerializer`
  (`backend/apps/tasks/serializers.py`) gains a `memo` field following the
  exact pattern already established for `id`/`title` (RF-006): truncated
  rather than rejected on write (`validate_memo` truncates to a max length,
  matching `validate_id`/`validate_title`'s `value[:MAX_LENGTH]` shape),
  since a hard reject would permanently block editing any task carrying an
  over-length legacy subtask.
- New module constant `SUBTASK_MEMO_MAX_LENGTH = 2000`, alongside the
  existing `SUBTASK_ID_MAX_LENGTH`/`SUBTASK_TITLE_MAX_LENGTH`. Like the
  200-item collection caps RF-006 already added, this is a generous,
  defensive bound with no specific product requirement behind the exact
  number — picked to prevent unbounded JSONField growth via one subtask's
  notes, not derived from a measured need. Documented as a judgment call to
  revisit if the owner wants a different number.
- No migration needed: existing subtask dicts simply lack the `memo` key,
  which reads as "no notes" on both sides (`subtask.get("memo")` on the
  backend, `subtask.memo` being `undefined` on the frontend) — the same
  missing-key-is-a-valid-state approach `excluded_dates`/`repeat_weekdays`
  already use elsewhere on `Task` itself.

## Promote and Nest now carry notes

**Promote** (`backend/apps/tasks/services.py`'s `promote_subtask`) already
copies `title`/`done` from the subtask dict into the newly created `Task`
(`services.py:513-519`). It now also copies `memo`, the same way.

**Nest** (`services.py`'s `nest_task`) currently treats the source task's
`memo` as a lossy field: `_nest_data_loss_fields` (`services.py:128-131`)
adds `"memo"` to the list whenever `task.memo` is truthy, forcing the
`confirm_data_loss` flow before nesting proceeds. The subtask dict actually
appended to the target (`services.py:211-214`, `{"id": ..., "title": ...,
"done": ...}`) now also carries `"memo": source.memo`, and `memo` is removed
from `_nest_data_loss_fields`'s checks entirely — nothing is lost anymore,
so there is nothing to confirm. This shrinks Nest's data-loss list from
nine fields to eight; the remaining ones (`completed_at`, `time`,
`duration_minutes`, `priority`, `due_date`, `background`,
`rollover_history`, `excluded_dates`) are unaffected — none of them have
anywhere to live on a subtask.

## Testing plan

Backend: `SubtaskSerializer`'s `memo` truncation (accept/reject-length
pair, matching the existing `id`/`title` tests); a create/update round-trip
proving `memo` persists and a missing key reads as absent; `promote_subtask`
copies a subtask's `memo` onto the new task; `nest_task` copies the source
task's `memo` onto the appended subtask dict, and `_nest_data_loss_fields`
no longer reports `memo` as lost (update the existing
`test_nest_detects_data_loss_for_every_lossy_field_individually`
parametrization to eight fields).

Frontend: the Subtask Detail sheet opens on title click instead of the old
inline editor; title and notes are both editable and commit correctly;
close (✕) and re-clicking the row both dismiss it; the plain (non-drawer)
`SubtaskList` variant is unaffected — same inline-rename behavior as today.

## Open items intentionally deferred

- No dedicated UI is added for viewing a subtask's notes without opening
  the sheet (e.g. a notes-present indicator dot on the row) — out of scope
  unless the owner wants it later.
- The sheet doesn't expose done-toggle, promote, or delete — those stay on
  the row, unchanged.

# Task Sync — Backend API

**Date:** 2026-07-27
**Status:** Approved
**Related:** this is the first of two sub-projects for cross-device task sync.
The second (swapping the frontend's `TaskRepository` to call this API,
plus one-time migration of existing localStorage tasks) is a separate,
later spec/plan.

## Problem

The task app (`frontend/src/features/tasks/`) persists everything to the
browser's localStorage via `createLocalStorageRepository()`
(`frontend/src/features/tasks/data/repository.ts`). Nothing is synced
across devices or browsers, even though `/app` is already gated by a full
JWT auth system (`backend/apps/accounts/`) — every user of the task app is
already logged in, but their tasks never reach their account.

## Goal

A Django `tasks` app exposing a per-user CRUD API for tasks, so that a
future frontend change can make it the actual source of truth instead of
localStorage. This spec covers only the backend: the model, the API, and
its tests. It does not touch the frontend.

## Scope decisions already made

- **Conflict model:** the server is always the source of truth. Every
  write goes straight to the API in real time; there is no offline queue,
  no merge logic, no conflict resolution. (This shapes the API surface —
  plain CRUD, no versioning/ETags/conflict responses needed.)
- **Business logic stays client-side.** Rollover (`lib/rollover.ts`) and
  routine materialization (`lib/routines.ts`) are pure functions the
  frontend already runs on whatever `repo.list()` returns, then persists
  any resulting change via ordinary `repo.update()` calls. The server does
  not need to understand or replicate any of that — it's a plain per-user
  CRUD store for whatever task rows the client sends it.

## Data Model

New app: `backend/apps/tasks/`, following the existing `apps/accounts`
app's layout (`models.py`, `serializers.py`, `views.py`, `urls.py`,
`tests.py`, `apps.py`).

One model, mirroring `frontend/src/features/tasks/types.ts`'s `Task`
interface field-for-field:

```python
SCOPE_KIND_CHOICES = [
    ("day", "day"),
    ("week", "week"),
    ("month", "month"),
    ("year", "year"),
]


class Task(models.Model):
    id = models.UUIDField(primary_key=True, editable=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="tasks"
    )
    title = models.CharField(max_length=500)
    memo = models.TextField(blank=True, null=True)
    done = models.BooleanField(default=False)
    scope_kind = models.CharField(max_length=10, choices=SCOPE_KIND_CHOICES)
    scope_value = models.CharField(max_length=20)
    rolled_from_kind = models.CharField(
        max_length=10, blank=True, null=True, choices=SCOPE_KIND_CHOICES
    )
    rolled_from_value = models.CharField(max_length=20, blank=True, null=True)
    created_at = models.CharField(max_length=32)
    completed_at = models.CharField(max_length=32, blank=True, null=True)
    time = models.CharField(max_length=5, blank=True, null=True)
    subtasks = models.JSONField(default=list, blank=True)
    repeat_weekdays = models.JSONField(blank=True, null=True)
    repeat_source_id = models.ForeignKey(
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
        indexes = [models.Index(fields=["user"])]
```

Notable choices:

- **`id` is client-supplied, not server-generated.** The frontend already
  generates the id via `crypto.randomUUID()` at creation time
  (`store.tsx`'s `addTask`) and uses it immediately for optimistic local
  state before any persistence call resolves. Keeping the client as the
  id authority means the add-flow doesn't change at all in the frontend
  sub-project — `create()` just sends the id it already made. The
  model field needs `editable=True` for this to work: DRF's
  `ModelSerializer` auto-generates a `read_only` serializer field for any
  model field where `editable=False` (which is Django's default for
  primary keys), so without it the client-sent `id` would be silently
  dropped on create instead of being accepted.
- **`created_at`/`completed_at` are opaque `CharField`s, not
  `DateTimeField`s.** The frontend never does date arithmetic on them —
  only displays and string-sorts them — so a real `DateTimeField` buys
  nothing and risks Django/DRF subtly reformatting the ISO string on
  round-trip (different fractional-second precision, timezone
  normalization) in a way that could break an exact-string round-trip
  test for no benefit.
- **`repeat_source_id` is a real self-referential `ForeignKey`, not a
  loose `UUIDField`.** It models a genuine relationship (an occurrence
  really does reference its anchor) and Django gives referential
  integrity for free — a repeat_source_id can't point at a nonexistent
  task or another user's task. `on_delete=SET_NULL` because deleting an
  anchor shouldn't cascade-delete every occurrence it ever spawned.
- **`scope`/`rolledFrom` are flattened to a `_kind`/`_value` pair**,
  mirroring the frontend's own `scopeKey()` concept (`types.ts`) — one
  column for which kind of scope, one for its single associated string
  (date / weekStart / month / year). Not a separate `Scope` model or a
  JSON blob: the frontend always needs the whole scope together, never
  queries into just one part of it, so a full normalization would add
  tables and serializer nesting for no real benefit (over-engineering),
  while a JSON blob would lose the DB-level `choices` validation on
  `kind` for no benefit either.
- **`subtasks`, `repeat_weekdays`, `excluded_dates` stay as JSON
  columns.** These are the genuinely list-shaped, always-fetched-whole
  parts of a task — matching exactly what `repository.ts`'s
  `normalizeTask` already treats as "validate as an array, otherwise
  clear it" on the frontend's own local-storage repository.
- **`updated_at` is server-only bookkeeping** (`auto_now=True`) — not
  part of the frontend `Task` shape, not returned to or read by the
  frontend in this sub-project. Included because it's standard, cheap,
  and useful for support/debugging later; nothing here depends on it.

## API

Two DRF generic views, following `apps/accounts`'s existing style (plain
`generics`/`APIView` classes, explicit `path()` entries in the same file
`config/urls.py` already uses — no viewsets, no routers):

- `GET /api/tasks/` — list the authenticated user's tasks.
- `POST /api/tasks/` — create a task. Client sends the complete object,
  including its own `id`.
- `GET /api/tasks/<uuid:id>/` — retrieve one (unused by the frontend
  today, but comes free with the generic view and costs nothing to
  expose).
- `PUT /api/tasks/<uuid:id>/` — full replace. The frontend's `update()`
  always rebuilds and sends the *entire* task object (never a partial
  diff), so `PUT` is the right verb, not `PATCH` — though DRF's
  `RetrieveUpdateDestroyAPIView` supports `PATCH` too as a side effect of
  the generic view; nothing will call it yet.
- `DELETE /api/tasks/<uuid:id>/` — remove.

**Permissions:** `IsAuthenticated` is already this project's
`DEFAULT_PERMISSION_CLASSES` (`config/settings.py`), so this is free, but
each view sets it explicitly anyway to match how `MeView` already does
despite the same default. Both views must override `get_queryset()` to
filter to `Task.objects.filter(user=self.request.user)` — this is the
actual security boundary (nothing else prevents cross-user access). A
request for another user's task id returns **404, not 403** — this falls
out naturally from a user-filtered queryset feeding DRF's standard
`get_object()`, and is the correct behavior (a 403 would leak that the id
exists at all).

**Create must not trust a client-sent `user`.** The serializer's `user`
field is not writable; the view's `perform_create` sets
`serializer.save(user=self.request.user)` explicitly.

**Error responses** follow the existing convention the frontend's
`apiRequest`/`readErrorMessage` (`frontend/src/lib/api/server.ts`) already
expects: DRF's default validation-error shape, and `{"detail": "..."}"`
for `permission_denied`/`not_authenticated`/`not_found` — no custom error
envelope introduced. (This detail matters for the frontend sub-project,
not this one, but keeping the shape consistent now avoids a mismatch
later.)

## Testing

Match `apps/accounts/tests.py`'s existing style: `django.test.TestCase` +
`rest_framework.test.APIClient`, real HTTP calls through the URL
conf (not calling view methods directly), `self.client.credentials(...)`
for auth. Cover:

- List returns only the authenticated user's own tasks, not another
  user's.
- Create round-trips every field, including nested `subtasks` and a
  `repeat_source_id` pointing at another of the same user's tasks.
- Update fully replaces a task's fields (send a changed object, confirm
  the stored row matches exactly, not merged with the old values).
- Delete removes the row; a repeat occurrence's `repeat_source_id`
  becomes `null` (not the occurrence itself deleted) when its anchor is
  deleted, per `on_delete=SET_NULL`.
- Unauthenticated requests to any endpoint get 401.
- GET/PUT/DELETE on another user's task id returns 404.
- Creating a task whose `repeat_source_id` points at a nonexistent id, or
  at another user's task id, is rejected with a validation error (DRF's
  default FK-existence check already does the "nonexistent id" half;
  the "another user's task" half needs the serializer/view to scope the
  FK's queryset to the requesting user, not `Task.objects.all()`).

## Non-goals

- No offline queue, conflict resolution, or partial-update (`PATCH`)
  usage — per the conflict-model decision above.
- No change to `lib/rollover.ts` / `lib/routines.ts` or any other
  client-side scheduling logic.
- No frontend changes at all — covered by a later, separate spec.
- No bulk/batch endpoints (e.g. a single call to upload many localStorage
  tasks at once during migration) — left for the frontend sub-project to
  decide, since it depends on that sub-project's exact migration design.

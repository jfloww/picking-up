# Task Sync — Frontend Integration

**Date:** 2026-07-27
**Status:** Approved
**Related:** second of two sub-projects for cross-device task sync. The
first, `2026-07-27-tasks-sync-backend-design.md`, built and shipped the
Django `tasks` API this spec now integrates with (merged, PR #31).

## Problem

The task app persists everything to the browser's localStorage via
`createLocalStorageRepository()`
(`frontend/src/features/tasks/data/repository.ts`). The backend now has a
real per-user CRUD API (`/api/tasks/`), but nothing on the frontend calls
it — tasks still never leave the browser they were created in.

## Goal

Swap the task store over to the new API, so tasks sync across devices for
the already-required-to-be-logged-in user, with existing localStorage data
carried over automatically the first time this ships to a given browser.

## Scope decisions already made

- **Server is always the source of truth** (from the backend spec) — every
  write goes straight to the API in real time. No offline queue, no merge
  logic.
- **Auto-import on first sync** — the first time a logged-in browser loads
  the app after this ships, if the server has no tasks yet, its
  localStorage tasks are uploaded once automatically.
- **On a failed write:** show a dismissible error banner and resync the
  full task list from the server, discarding whatever optimistic change
  didn't actually persist.

## Architecture

Follows the existing auth flow's BFF pattern exactly
(`frontend/src/features/auth/api/auth.ts` +
`frontend/src/app/api/auth/*/route.ts`) — nothing new is invented here,
just applied to a second resource:

```
TasksProvider (store.tsx)
  → TaskRepository (list/create/update/remove)
      → createApiTaskRepository()               [new, client-side]
          → fetch("/api/tasks/...")              [same-origin, browser sends the httpOnly cookie automatically]
              → Next.js Route Handlers           [new, thin, untested — matches app/api/auth/*/route.ts]
                  → features/tasks/api/tasks.ts  [new, server-side, tested — matches features/auth/api/auth.ts]
                      → apiRequest()             [existing, frontend/src/lib/api/server.ts]
                          → Django /api/tasks/*  [existing, shipped in the backend sub-project]
```

The client-side repository never sees a token or a snake_case field name —
both are fully contained in the server-side layer, matching how auth
already keeps that boundary.

## Field mapping

`features/tasks/api/tasks.ts` owns `toApiPayload(task: Task)` and
`fromApiPayload(payload): Task`, translating between the frontend's
camelCase `Task` (`types.ts`) and the backend's snake_case fields
(`scope`/`rolledFrom` objects ↔ `scope_kind`+`scope_value` /
`rolled_from_kind`+`rolled_from_value`; `repeatSourceId` ↔ `repeat_source`;
everything else is a direct camelCase↔snake_case rename). `subtasks`'
inner shape (`{id, title, done}`) needs no translation — it's identical on
both sides.

## Migration

Lives entirely inside `createApiTaskRepository()`'s `list()` method, not
in `store.tsx` (which stays repository-agnostic, same as it is today).

**The trigger is "does localStorage still hold the legacy key," not
"is the server list empty."** An earlier draft of this spec gated
migration on an empty server list, reasoning that a `400`
(already-exists) response makes retrying safe — but that's inconsistent
with itself: if a first attempt uploads 3 of 10 tasks before failing
(network drop on the 4th), the server list is no longer empty, so a
retry gated on "list is empty" would skip migration entirely and never
upload the remaining 7. Gating on localStorage's own presence instead
means the retry always re-attempts the *full* original local set,
regardless of how many the server already has — which is exactly what
makes the per-task idempotent `POST` (step 3 below) a correct retry
strategy rather than an incomplete one.

1. Read the same localStorage key `createLocalStorageRepository` already
   uses. If it's absent or empty, there's nothing to migrate (either a
   brand new account, or this browser already migrated and cleared it) —
   just return `requestListTasks()` directly. This is the common case on
   every load after the first, so it costs nothing beyond a
   `localStorage.getItem` call.
2. Otherwise, `POST` each local task to the server, one at a time.
3. For each, a `2xx` is success. A `400` needs its response body
   inspected — only treat it as "already migrated, continue" if the
   error is specifically the duplicate-id rejection (`{"id": [...]}`
   naming that field); any other `400` (a genuinely malformed local
   task — e.g. from old, since-fixed corrupt data) or non-2xx/400 status
   is a real failure: stop the loop and let it throw. Blanket-treating
   every `400` as "already exists" would silently and permanently drop a
   task that failed validation for an unrelated reason, since step 4
   would then clear the very data needed to retry it.
4. Only once every local task got a 2xx-or-already-exists response, clear
   that localStorage key and re-fetch the now-populated list from the
   server.

If step 3 throws, `list()` throws without clearing localStorage — the
next load reads the same still-present legacy key and retries the full
batch from step 2, safely, since every already-uploaded task now just
produces the tolerated duplicate-id `400`.

No bulk/batch endpoint — sequential one-at-a-time `POST`s. This only runs
once per browser, ever, so a brief pause is an acceptable cost for the
simplicity of not needing a batch endpoint on the backend.

## Error handling

Every `store.tsx` action currently does `void repo.update(task)` — fire
and forget, since localStorage can't meaningfully fail. Change the pattern
throughout to `repo.update(task).catch(handleSyncFailure)` (drop `void`,
since the rejection is now handled), where `handleSyncFailure`:

1. Sets a new `syncError: string | null` field on `TasksState` to a
   user-facing message.
2. Re-fetches `repo.list()` and dispatches the result, replacing whatever
   optimistic state existed — guarantees the UI matches the server after
   any failure, per the "resync" decision above.

The initial mount's `repo.list()` call also needs a `.catch()` it doesn't
have today: on failure, set `syncError` and dispatch `loaded: true` with
an empty task list, rather than leaving the app hung on an implicit
loading state forever. The user can reload once whatever failed
(connectivity, an expired session) is resolved.

**UI:** reuse the existing `Alert` component (`components/ui/alert.tsx`,
already used for auth form errors) — no new dependency. Rendered once,
dismissible, wherever `TaskCalendar` renders its top-level chrome. A
`dismissSyncError()` action clears it from context.

## Non-goals

- **No proactive token refresh inside the new Route Handlers.** The access
  token is short-lived (15 min); `middleware.ts` already refreshes it on
  every page navigation to/within `/app`, but a tab left open through a
  long uninterrupted editing session could still hit an expired token
  mid-session. If that happens, the write fails, the error banner shows,
  and reloading the page (which goes through `middleware.ts`'s refresh
  path) recovers it. A route-handler-level refresh-and-retry would remove
  even that brief friction, but is real added complexity duplicating
  `middleware.ts`'s `refreshTokens` logic — left as a future improvement,
  not required for this integration.
- **No offline queue or conflict resolution** — already decided in the
  backend spec, restated here since it directly shapes the error-handling
  design above (a failed write is just an error, not something queued for
  later).
- **No changes to `lib/rollover.ts` / `lib/routines.ts`** or any other
  scheduling logic — still pure functions `store.tsx` runs on whatever
  `repo.list()` returns, unaffected by which repository that is.
- **No bulk/batch API endpoint** — per the Migration section above.

## Testing

- `features/tasks/api/tasks.ts`: unit tests mocking `apiRequest` (same
  style as `features/auth/api/auth.test.ts`) — each request function
  builds the right path/method/body and maps the response correctly in
  both directions; a thrown `apiRequest` error propagates.
- `data/api-task-repository.ts`: unit tests mocking global `fetch` and
  `localStorage` — `list()`'s branches: no legacy key present (skips
  migration, calls the server exactly once); legacy key present, all
  uploads succeed (uploads each, then clears the key, then re-fetches);
  a retry where some tasks already exist server-side (each duplicate-id
  `400` is tolerated, not treated as failure); a genuine validation `400`
  on one task (the whole migration throws, and the legacy key is *not*
  cleared, so the next attempt retries the full batch). Also that
  `create`/`update`/`remove` call the right endpoint/method and throw on
  a non-ok response.
- `store.tsx`: existing tests already use `fakeRepository()`, unaffected
  by the default-repository swap. New tests: a failing `repo.update()`
  (etc.) sets `syncError` and resyncs from a fresh `repo.list()`; the
  initial `repo.list()` failing sets `syncError` and still reaches
  `loaded: true` with an empty list; `dismissSyncError()` clears it.
- Route handlers (`app/api/tasks/*/route.ts`): left untested, matching
  the existing, deliberate convention for `app/api/auth/*/route.ts` — the
  logic they call is what's tested, not the thin wrapper.

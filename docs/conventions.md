# Coding & Process Conventions

_Extracted from the specs, plans, and review decisions of the first two feature efforts.
When in doubt, match what `frontend/src/features/tasks/` does._

## TypeScript & code style

- **Strict TypeScript everywhere.** Model variants as discriminated unions
  (see `Scope` in `features/tasks/types.ts`) and validate untrusted data at the IO
  boundary with type guards (`isTask`/`isScope` in `data/repository.ts`) — the guard
  must check the union's payload field, not just the discriminant.
- **Date keys are strings**: day `"YYYY-MM-DD"`, week = its Sunday's day-key, month
  `"YYYY-MM"`, year `"YYYY"`. Order with ISO string comparison (`<`, `===`).
  Never compare `Date` objects; use `Date` only inside `lib/dates.ts` for arithmetic.
- **Weeks start Sunday.**
- **Pure core, thin shell.** Business rules (date math, rollover) are pure, exported,
  unit-tested functions in `lib/`. Effects (storage, listeners, network) live only in
  the store/repository layer.
- **Feature folders own their code** (`features/<name>/`). Shared code must earn its
  place in `components/` or `lib/`.
- Prefer small files with one clear responsibility; export the interface neighbors
  need (`CalendarViewProps`, `DAY_LABELS` come from `weekly-view.tsx` — siblings
  import them rather than redefining).
- `"use client"` on every component that uses state, effects, or event handlers.
  Server components (pages) compose them.
- Comments only for constraints the code can't show (e.g. the decode-only note in
  `middleware.ts`); no narration of what the next line does.

## Styling

- **Tailwind utilities with design tokens only** — the CSS variables defined in
  `app/globals.css` (`bg-card`, `text-subtle`, `text-brand`, `ring-ring`, `bg-muted`,
  `text-destructive`, …). No hex values in components, no new global CSS classes.
- Both themes always: tokens have light values in `:root` and dark values in `.dark`
  (next-themes toggles the class). If it looks right in one theme only, it's wrong.
- Base UI primitives wrapped shadcn-style in `components/ui/`; extend those rather
  than styling raw elements.
- Accessibility floor: interactive fakes get `role`, `tabIndex`, and keyboard handlers
  (see `PeriodCell`); controls get `aria-label`s; view switchers use
  `role="tablist"`/`aria-selected`.

## Configuration

- **No hardcoded config and no fallback defaults in app code** — `.env` files are the
  single source of truth (`DJANGO_API_BASE_URL`, etc.; see `backend/.env.example`).
  The one sanctioned constant is a storage key (`picking-up.tasks.v1`).

## Testing

- **Vitest + Testing Library + jsdom**, colocated as `*.test.ts(x)` next to the file
  under test. Config: `frontend/vitest.config.ts` (globals disabled — import
  `describe/it/expect/vi` explicitly); `frontend/vitest.setup.ts` runs RTL `cleanup()`
  and `localStorage.clear()` after every test.
- **TDD**: write the failing test, watch it fail (RED), implement, watch it pass
  (GREEN), then commit. The RED step is evidence, not ceremony.
- Test **behavior through the public surface**: render with `TasksProvider` + the
  in-memory `fakeRepository` from `test-utils.tsx`, fire events, assert what the user
  sees. Never mock the unit under test.
- **No wall-clock dependence.** Either derive fixtures from `todayKey()` or pin the
  clock with `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime(...)`
  (fake only `Date` so RTL `waitFor` keeps working). A test that will fail next month
  is a bug (this bit us — see development record, final-review fix).
- Test output must be pristine: no `act()` warnings, no console noise.

## Git & process

- **Conventional commits** (`feat:`, `fix:`, `docs:`, `chore:`, `test:`), commit
  message ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` for
  agent-authored commits. Small, per-task commits.
- Feature branches (`feat/<name>`); never commit directly to `main`. Stacked branches
  are fine but note the base in the PR ("merge X first").
- **Workflow per feature**: brainstorm → approved spec
  (`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`) → TDD implementation plan
  (`docs/superpowers/plans/YYYY-MM-DD-<topic>.md`) → execution with a review gate per
  task → final whole-branch review → fix wave → merge. Progress is journaled in
  `.superpowers/sdd/progress.md` (git-ignored scratch).
- Review findings are triaged by severity: Critical/Important fixed before the task
  is accepted; Minors recorded and triaged at the final review (fix-before-merge vs
  tracked follow-up). Follow-ups land in `docs/development-record.md`, not in memory.
- Verification before completion claims: `npm test`, `npm run lint`, `npm run build`
  all green, plus a manual browser pass for UI work.

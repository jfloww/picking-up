# Development Record

Chronological record of what was built, how, and what's still open.
Specs are the behavioral source of truth; plans are the executed TDD scripts.

---

## Feature 1 — Landing page & auth redesign (2026-07-15)

- **Spec:** [superpowers/specs/2026-07-15-landing-auth-design.md](superpowers/specs/2026-07-15-landing-auth-design.md)
- **Plan:** [superpowers/plans/2026-07-15-landing-auth-redesign.md](superpowers/plans/2026-07-15-landing-auth-redesign.md)
- **Branch:** `feat/landing-auth-design` (commits `1d4181a..aa0a62b`)

**What was built (5 tasks, each TDD'd and reviewed):**

1. Design tokens + Tailwind 4 setup (steel-blue brand, light/dark CSS variables)
2. Theme provider + toggle (next-themes)
3. Login/signup rebuild in Tesla-minimal style (`auth-layout`, `auth-form`, ui/ primitives)
4. Landing page with task-mock hero (`task-mock.tsx`, wordmark)
5. Env/backend fixes (`.env.development` fallback loading, settings.py env handling)

**Notable review outcomes:** dependency hygiene moved build tools to devDependencies;
theme-toggle a11y fix (tabIndex/disabled pre-mount); `.env` load-order documented.
Oracle test-DB creation was blocked by `ORA-01031` for `pickingup_app` — backend tests
run on the SQLite fallback (known, unresolved).

---

## Feature 2 — Multi-scale task calendar (2026-07-16)

- **Spec:** [superpowers/specs/2026-07-16-task-calendar-design.md](superpowers/specs/2026-07-16-task-calendar-design.md)
- **Plan:** [superpowers/plans/2026-07-16-task-calendar.md](superpowers/plans/2026-07-16-task-calendar.md)
- **Branch:** `feat/task-calendar`, stacked on the landing branch (14 commits, `562b741..53f5668`)
- **Merged:** PR #2 → `main` (`c7d4eca`), 2026-07-16 — brought both stacked features in.

**Concept:** every view shows the parent time container with the current unit focused
and the rest faded ("zoomed-out context, focused present"); unfinished tasks roll
forward automatically. See `docs/architecture.md` for the resulting design.

**Execution (9 TDD tasks, subagent-driven, one review gate each):**

| Task | Deliverable | Commits | Review outcome |
|---|---|---|---|
| 1 | Vitest infra + `lib/dates.ts` | `1b8d48b`, `59a8794` | Fix: missing `@testing-library/dom` peer dep (was masked by `--legacy-peer-deps`) |
| 2 | `types.ts` + `lib/rollover.ts` | `937d839` | Clean |
| 3 | localStorage repository | `f00e8e6`, `300b955` | Fix: `isTask` now validates scope payload fields (plan-mandated gap) |
| 4 | Store (context + reducer, rollover on load) | `3e8f0bd` | Clean |
| 5 | UI primitives (QuickAdd, TaskItem, PeriodCell, ScopeTasks) | `79a5447` | Clean; added `vitest.setup.ts` (RTL cleanup — required with globals off) |
| 6 | Weekly view (default) | `752c34b` | Clean |
| 7 | Daily view | `e1f24b7` | Clean |
| 8 | Monthly + Yearly views (shared `YearGrid`) | `0e1d36f` | Clean; RED phase not observed (session outage) — reviewer traced all tests as non-vacuous |
| 9 | ViewSwitcher + TaskCalendar + `/app` page + legacy CSS removal | `eb098f2`, `270a600` | Clean; `eslint.config.mjs` added (`next lint` was broken repo-wide before) |

**Final whole-branch review:** verdict "ready to merge, with fixes." Two Important
findings, both fixed in `53f5668`:

1. **Time-bomb tests** — view tests hardcoded July-2026 fixtures against the real
   clock through rollover; they would have started failing in CI on 2026-08-01.
   Fixed by pinning the clock (`vi.useFakeTimers({ toFake: ["Date"] })`); now a
   standing convention (see `docs/conventions.md` → Testing).
2. **Rollover only ran on mount** — spec says "on load *or when the date changes*."
   Added `focus`/`visibilitychange` listeners that re-run rollover on day change,
   with a fake-clock TDD test.

Plus one line of permanent test isolation (`localStorage.clear()` in setup).
Re-review verdict: **ready to merge — yes.** Final state: 43/43 tests, lint clean,
build compiles (11 routes).

---

## Open follow-ups

Tracked here so they survive context loss; triaged ship-as-is at the final review
unless noted.

- [ ] **Manual browser pass on `/app`** (needs an authenticated session) — the only
      unverified surface after merge.
- [ ] **A11y batch:** TaskItem expand button `aria-expanded`/`aria-controls`;
      ViewSwitcher `aria-controls` + roving tabindex (full APG tab pattern); drop the
      no-op `aria-label` on focused `PeriodCell` divs.
- [ ] **Persistence error handling** in the store's fire-and-forget repo calls
      (`.catch` + user-visible failure) — required before the Django repository swap;
      `localStorage.setItem` can throw today (quota/private mode) and is silently
      swallowed.
- [ ] **Django task API** → HTTP `TaskRepository` implementation (the seam is ready).
- [ ] `tasksRef` in `store.tsx` is assigned in the render body; not exploitable by
      real DOM events, but move to `useLayoutEffect` for defense-in-depth.
- [ ] Add `@eslint/eslintrc` as an explicit devDependency (currently transitive via
      eslint 9 — matches create-next-app norm, but cheap hygiene).
- [ ] Backend: Oracle test-DB creation blocked by `ORA-01031` for `pickingup_app`
      (tests fall back to SQLite).
- [ ] DailyView header shows the anchor's month even when the strip spans two months
      (cosmetic).

## Process notes

Both features followed the same pipeline: **brainstorm → approved spec → TDD plan →
subagent-driven execution** (fresh implementer per task + independent spec/quality
review per task, fix-and-re-review loops) → **final whole-branch review** on the full
diff → fix wave → merge. Per-task reviews caught layer-local defects (missing peer
dep, validation gap); the final review caught exactly the class of problem per-task
gates can't see (clock-dependent tests that passed on review day, a spec clause no
single task owned). Keep both gates.

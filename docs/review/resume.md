# Picking Up — resume entry

A concise resume version of the project with one frontend bullet, two backend
bullets, and one deployment bullet. The entry presents full-stack ownership
while emphasizing backend domain design, concurrency, and data integrity.

---

## Resume entry

**Picking Up** — Full-stack task and routine planner

*Next.js, TypeScript, Django REST Framework, PostgreSQL (Neon), Docker, Google Cloud Run, Vercel*

- **Frontend:** Built responsive Daily, Weekly, and Monthly planning workflows
  for desktop and 320px-wide mobile screens, including agenda/timeline modes,
  full-screen task editing, and drag-to-reorder/reschedule interactions with
  optimistic state reconciliation.
- **Backend:** Designed six versioned, transactional DRF command endpoints for
  nesting, promoting, detaching, deleting, rescheduling, and reordering tasks,
  using atomic transactions, row-level locks, and `409 Conflict` responses to
  prevent stale or partial multi-record writes.
- **Backend:** Closed data-integrity and authentication risks by enforcing
  normalized, case-insensitive category uniqueness at the database boundary
  and making login throttling proxy-aware so one client could not exhaust the
  site-wide authentication budget.
- **Deployment:** Migrated production from Oracle Autonomous Database and an
  OCI VM to Dockerized Django on Cloud Run with Neon PostgreSQL and a Next.js
  BFF on Vercel, then verified authentication and task read/write flows through
  the live stack.

## Notes (not resume copy)

- The frontend and deployment bullets establish end-to-end ownership; the two
  middle bullets carry the backend-specialist story.
- The authentication issue was fixed through proxy-aware throttling and a
  production configuration guard, not a database constraint. The database
  boundary claim applies specifically to category uniqueness.
- Avoid adding user counts, scale claims, or fixed test counts unless they are
  verified again when the resume is finalized.

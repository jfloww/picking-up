# Development History: PostgreSQL Migration — Phase A

## Date

2026-08-08

## Goal

Move the production database off Oracle Autonomous DB (OCI Always Free) to
Neon PostgreSQL — suspected cause of slow API responses. Full plan lives in
`docs/db-migration/postgres-migration-plan.md`; this entry records what was
actually done and decided during today's session.

## Decisions Made

- Keep the OCI VM as the backend host — this is a database-only swap, not a
  move to Cloud Run or any other compute platform. (Considered Vercel +
  Cloud Run + Neon; rejected for now — containerizing Django was explicitly
  deferred in the original deployment runbook, and stacking Cloud Run's and
  Neon's independent scale-to-zero cold starts risked feeling *slower* than
  today's always-on VM for a low-traffic personal app.)
- **Data migration is not needed.** Neon starts from a clean `migrate` with
  no data carried over from Oracle. `docs/db-migration/postgres-migration-plan.md`'s
  Phase B (dumpdata/loaddata dry run) is marked skipped; Phase C (cutover)
  was simplified to drop the export/import steps accordingly.
- Use Neon's **direct** (non-pooled) connection string, not the PgBouncer
  pooled one — gunicorn only runs 2 workers, not enough concurrency to need
  a pooler, and it avoids psycopg3/PgBouncer transaction-pooling caveats.

## Work Completed

Confirmed via code reading (no code changes needed for Postgres support —
it already existed):

- `backend/config/settings.py:88-113` already branches on
  `ORACLE_DB_USER/PASSWORD/DSN` → Oracle, else `DATABASE_URL` → `env.db()`,
  else SQLite.
- `psycopg[binary]` was already in `requirements.txt` (left over from
  before Oracle was chosen).
- No migration under `apps/*/migrations/` contains Oracle-specific SQL —
  the only `RunSQL` (`apps/accounts/migrations/0002_unique_user_email.py`)
  is a portable `CREATE UNIQUE INDEX`.

Local environment (`backend/.env`) changed:

- Commented out `ORACLE_DB_USER`/`ORACLE_DB_PASSWORD`/`ORACLE_DB_DSN`.
- Added `DATABASE_URL=<neon-direct-connection-string>?sslmode=require`.

Phase A executed against the empty Neon `production` branch:

```text
.venv/bin/python manage.py check
.venv/bin/python manage.py migrate
.venv/bin/python manage.py test apps.accounts apps.tasks
```

Result:

```text
System check identified no issues.
44/44 migrations applied cleanly.
193/193 tests passed (apps.accounts + apps.tasks — auth, task CRUD,
subtasks, bucket categories, repeat rules, throttling, migration
backfills).
```

Confirmed live vendor at runtime:

```text
connection.vendor -> postgresql
NAME -> neondb
HOST -> ep-lively-darkness-avopojwg.c-11.us-east-1.aws.neon.tech
```

Local-machine-to-Neon round-trip reference (not representative of the OCI
VM's actual latency to Neon — this machine isn't the VM):

```text
query 0: 245ms (cold)
query 1-4: ~27ms each (warm)
```

## Unrelated Fix: Local Google Sign-In

While testing, "Sign in with Google" wasn't rendering locally.
`frontend/src/features/auth/components/google-sign-in-button.tsx:83`
returns `null` when `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is unset — neither
`backend/.env.development` nor `frontend/.env.development` had a Google
client ID configured on this machine (only the OCI production `.env` did).
Fixed by adding the existing OAuth client ID (same one already authorized
for the Vercel production origin) to both:

```text
backend/.env.development:   GOOGLE_OAUTH_CLIENT_ID=...
frontend/.env.development:  NEXT_PUBLIC_GOOGLE_CLIENT_ID=...
```

Noted as a follow-up to check: Google Cloud Console's Authorized JavaScript
origins for this client ID needs `http://localhost:<frontend-port>` added,
or the button renders but sign-in fails.

## Current State

```text
Local dev backend  -> PostgreSQL (Neon), confirmed at runtime
Production backend -> Oracle Autonomous DB (OCI), unchanged
```

Neon project details (from the Neon dashboard):

```text
Region: AWS us-east-1 (N. Virginia)
Branch: production (default, autoscaling 0.25-2 CU)
Free tier: 100 CU-hrs/month compute, 0.5 GB storage, 5 GB network transfer
Autosuspend: 5 min idle (default)
```

## Deferred / Next Steps

Tracked in `docs/db-migration/postgres-migration-plan.md`'s checklist:

```text
1. Latency comparison, Oracle vs Neon, run from the OCI VM itself
   (needs key/ssh-key-2026-07-14.key — not present on this machine,
   run from the Windows dev setup).
2. Phase C: production cutover during a maintenance window (simplified —
   migrate only, no data import since Phase B was skipped).
3. Phase D: confirm rollback plan (Oracle vars stay commented, not
   deleted, in the VM .env for a burn-in period).
4. Phase E cleanup after burn-in: remove the Oracle branch from
   settings.py, drop oracledb from requirements.txt, note
   docs/planning/6. oracle-database.md as superseded.
```

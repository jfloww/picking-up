# PostgreSQL Migration Plan: Oracle Autonomous DB → Neon

**Goal:** Replace the OCI Always-Free Oracle Autonomous DB with Neon PostgreSQL as
the production database, without touching anything else in the stack.

**Why:** The Oracle Autonomous DB Always-Free instance (`PICKINGUPDB`, `26ai`,
Free instance type — see the Aug 8 2026 OCI console screenshot) is suspected
to be the source of slow API responses, not the OCI compute VM. This plan
swaps only the database. It does **not** move the backend off the OCI VM —
gunicorn, nginx, systemd, and DuckDNS from
[`docs/planning/7. deployment-runbook.md`](../planning/7.%20deployment-runbook.md)
stay exactly as they are. Moving the backend to Cloud Run (or anywhere else)
is a separate decision, deliberately out of scope here — see
[Deciding whether to stop at Neon](#deciding-whether-to-stop-at-neon) below.

**Update, 2026-08-08:** the Cloud Run move happened anyway, decided
separately from this doc's own DB-only scope. Backend hosting is migrating
to Google Cloud Run (source deploy via buildpacks, Dockerfile deferred) —
see [`docs/db-migration/cloud-run-deployment.md`](cloud-run-deployment.md).
Neon stays exactly as planned here; this doc's Phases A/B remain accurate,
Phase C (cutover) is superseded by the Cloud Run doc's own deploy steps.

**Current state, confirmed by reading the code (2026-08-08):**
- [`backend/config/settings.py:88-113`](../../backend/config/settings.py#L88-L113)
  already branches on env vars: `ORACLE_DB_USER/PASSWORD/DSN` set → Oracle;
  else `DATABASE_URL` set → `env.db()` (works for Postgres out of the box);
  else SQLite. **No Django code change is required to add Postgres support —
  it's already there.**
- `backend/requirements.txt` already has `psycopg[binary]>=3.2,<4.0`
  installed (left over from before Oracle was chosen) alongside
  `oracledb>=3.0,<4.0`.
- No migration under `apps/*/migrations/` contains Oracle-specific SQL. The
  only `RunSQL` in the whole codebase
  ([`apps/accounts/migrations/0002_unique_user_email.py`](../../backend/apps/accounts/migrations/0002_unique_user_email.py))
  is a plain `CREATE UNIQUE INDEX`, portable to Postgres as-is. The models
  were already written with cross-backend portability in mind (see the
  ORA-01408 comment at
  [`apps/tasks/models.py:108-113`](../../backend/apps/tasks/models.py#L108-L113)).
- Production has held real data since 2026-07-15 (the deployment runbook's
  smoke test: register, log in, create a task, reload).
- `connection.vendor` is logged once at startup
  ([`apps/accounts/apps.py:35`](../../backend/apps/accounts/apps.py#L35)) —
  informational only, not a behavioral branch.

**Neon project (already created, per Aug 8 2026 dashboard screenshot):**
- Region: AWS `us-east-1` (N. Virginia). The Oracle Autonomous DB is in OCI's
  `us-ashburn-1` (also Northern Virginia, per
  [`docs/planning/6. oracle-database.md`](../planning/6.%20oracle-database.md)),
  so the OCI VM is very likely in the same metro. VM→Neon network latency
  should be comparable to VM→Oracle today — this migration targets the DB
  engine's own performance ceiling, not a network-distance problem.
- Free tier: 100 CU-hrs/month compute, 0.5 GB storage, 5 GB network
  transfer, default autoscaling 0.25–2 CU on the `production` branch.
- Default autosuspend after 5 min idle — first query after idle pays a
  cold-start (typically sub-second). Expected behavior, not a bug; raising
  the timeout trades away compute-hour budget, so leave it on default unless
  it's actually a problem in practice.

**Connection string: use the direct (non-pooled) string, not PgBouncer.**
The systemd unit runs gunicorn with `--workers 2`
([`docs/planning/7. deployment-runbook.md:137`](../planning/7.%20deployment-runbook.md#L137)) —
too little concurrency to need a connection pooler, and it sidesteps
psycopg3's known prepared-statement caveats under PgBouncer's transaction
pooling mode. Revisit only if worker count grows substantially.

---

## Deciding whether to stop at Neon

Before spending any more effort: prove the hypothesis first. Once Phase A
below is done (empty Neon DB, schema migrated, app working locally against
it), run a latency comparison from the OCI VM itself before deciding on
anything past a straight database swap:

```
ssh -i "key/ssh-key-2026-07-14.key" opc@129.213.191.36
cd ~/picking-up/backend
DATABASE_URL='<neon-direct-connection-string>?sslmode=require' \
  .venv/bin/python manage.py shell -c "
import time
from django.db import connection
t0 = time.monotonic()
with connection.cursor() as c:
    c.execute('SELECT 1')
    c.fetchone()
print('Neon round-trip from VM:', time.monotonic() - t0)
"
```

This overrides `DATABASE_URL` only for that one shell process — it never
touches the running gunicorn service or its `.env`, so production traffic
stays on Oracle throughout. Compare against the same timing done against
`ORACLE_DB_DSN`. If Neon comes back an order of magnitude faster (e.g.
Oracle 700–1200ms vs Neon 80–200ms), the database was the bottleneck and
this plan is sufficient — no need to also move the backend to Cloud Run or
anywhere else. If both are similarly slow, the problem is more likely in
Django/network path on the VM side, and that's a different investigation.

---

## Phase A — Local Django against an empty Neon DB (today, zero production risk)

Oracle is untouched throughout this phase. Nothing here talks to production.

1. **Get the connection string.** Neon dashboard → your project → Connect →
   copy the **direct** connection string (not the pooled one — see above).
   It looks like:
   ```
   postgresql://<user>:<password>@<host>.us-east-1.aws.neon.tech/<dbname>?sslmode=require
   ```

2. **Point local `.env` at Neon.** In `backend/.env`, add (or uncomment) a
   `DATABASE_URL` line with the string from step 1. Leave
   `ORACLE_DB_USER`/`ORACLE_DB_PASSWORD`/`ORACLE_DB_DSN` as they are —
   [`settings.py:94`](../../backend/config/settings.py#L94) checks Oracle
   vars first, so if all three are still set from a prior local setup,
   Django will keep using Oracle instead of picking up `DATABASE_URL`. For
   this phase, make sure the Oracle vars are unset or commented out locally
   so the `elif DATABASE_URL:` branch actually runs.

3. **Confirm the driver is already installed:**
   ```
   cd backend
   .venv/bin/pip show psycopg
   ```
   Expect `Version: 3.x` — it's already in `requirements.txt`, this just
   confirms it's actually installed in the venv you're using.

4. **Sanity-check settings resolve correctly:**
   ```
   .venv/bin/python manage.py check
   ```

5. **Build the schema from scratch via Django migrations** (this is the
   "migrations generate the schema" step — no Oracle DDL is read or
   translated anywhere):
   ```
   .venv/bin/python manage.py migrate
   ```
   Expect all migrations across `admin`, `auth`, `contenttypes`, `sessions`,
   `token_blacklist`, `apps.accounts`, `apps.tasks` to apply cleanly to the
   empty Neon `production` branch.

6. **Full feature pass against the empty Neon DB**, run the dev server
   (`.venv/bin/python manage.py runserver`) against the frontend or via
   `curl`/DRF's browsable API, and confirm each of:
   - Register a new account, log in (email/password path)
   - Google sign-in (if `GOOGLE_OAUTH_CLIENT_ID` is set locally)
   - Create / edit / delete a Task
   - Bucket category create/assign
   - Subtask create/edit
   - Repeat rule create/edit (`repeat_weekdays`, `repeat_source`, the
     mutual-exclusion constraint at
     [`apps/tasks/models.py:134-137`](../../backend/apps/tasks/models.py#L134-L137))

   If all of this passes, that's confirmation there's no Oracle-specific
   behavior anywhere in the app — the code review above already suggested
   this, this step proves it empirically.

7. Run the latency comparison in
   [Deciding whether to stop at Neon](#deciding-whether-to-stop-at-neon) and
   decide whether to continue.

**Do not proceed to Phase B until step 6 is fully green.** If anything in
step 6 fails, that's a real portability bug to fix before any data is moved
— fixing it against an empty DB is far cheaper than debugging it against
migrated production data.

---

## Phase B — Data migration (SKIPPED — decided 2026-08-08)

Decision: no data migration. Oracle's current production data is not being
carried over to Neon — Neon starts from a clean `migrate` with no
`loaddata` step. The commands below are kept for reference (e.g. if this
situation recurs on a future re-migration with real data worth keeping),
but are not part of this migration's execution path. Phase C has been
simplified accordingly — it no longer exports from or reads Oracle at all.

<details>
<summary>Original data-migration approach (not used)</summary>

Oracle remains the source of truth and stays untouched until the cutover in
Phase C. This phase is a dry run: export, import into Neon, verify, and
repeat as many times as needed (Neon's `production` branch can just be wiped
and re-migrated — `manage.py migrate` on a branch you `flush` first, or
delete/recreate the branch in the Neon console).

1. **Export real app data from Oracle.** Point `backend/.env` back at Oracle
   (restore `ORACLE_DB_USER`/`PASSWORD`/`DSN`) and run, from a machine or SSH
   session with production Oracle access:
   ```
   .venv/bin/python manage.py dumpdata auth.user apps.accounts apps.tasks \
     --natural-foreign --indent 2 > datadump.json
   ```
   Scoping to `auth.user apps.accounts apps.tasks` deliberately excludes
   `contenttypes`, `auth.permission`, `admin.logentry`, `sessions.session`,
   and `token_blacklist` — those are Django-internal/session state, not app
   data, and re-populate or start empty naturally (`contenttypes`/
   `permissions` are recreated by `migrate`'s `post_migrate` signal; session
   and blacklisted-token rows are fine to lose — users just log in again
   once after cutover). `--natural-foreign` avoids PK-mismatch issues if any
   dumped row references a `Permission`/`ContentType` row by FK.

   `dumpdata` preserves the original primary keys by default — this is what
   keeps `Task.id` ↔ `Subtask.task_id` (and every other FK) intact on the
   Postgres side. No manual per-model export ordering is needed:
   `loaddata` (next step) disables FK constraint checking for the duration
   of its transaction, so a single combined fixture file loads safely
   regardless of row order within it.

2. **Load into Neon.** Point `backend/.env` at the Neon `DATABASE_URL` again,
   confirm the `production` branch is freshly migrated and empty
   (`manage.py migrate` on a clean branch), then:
   ```
   .venv/bin/python manage.py loaddata datadump.json
   ```

3. **Verify row counts match** between Oracle and Neon for each model that
   matters:
   ```
   .venv/bin/python manage.py shell -c "
   from django.contrib.auth.models import User
   from apps.accounts.models import GoogleIdentity
   from apps.tasks.models import Task
   print('users:', User.objects.count())
   print('google identities:', GoogleIdentity.objects.count())
   print('tasks:', Task.objects.count())
   "
   ```
   Run this against both databases (swap `DATABASE_URL` between runs) and
   diff the numbers. Also spot-check a specific record you know by ID
   (`Task.objects.get(id=<known-id>)`) on both sides to confirm PKs and FK
   relationships survived the round trip.

4. **Full feature pass again**, this time against the Neon copy of real
   data (not just an empty DB) — log in as your real account, confirm your
   actual tasks/categories/subtasks show up correctly.

If anything looks wrong, the fix is: adjust the export/import approach, wipe
the Neon `production` branch, and redo Phase B from step 1. Oracle hasn't
been touched, so there's no rollback needed at this stage — only the Neon
side gets reset.

</details>

---

## Phase C — Cutover (maintenance window, mirrors the existing runbook pattern)

Simplified per the Phase B skip decision: no data export/import, no
row-count verification — Neon goes live empty and starts collecting new
data from the cutover point forward.

1. SSH to the VM and stop gunicorn so no in-flight writes land in Oracle
   after the switch (same maintenance-window pattern as
   [`docs/planning/7. deployment-runbook.md`](../planning/7.%20deployment-runbook.md#L296-L320) — "Future updates"):
   ```
   ssh -i "key/ssh-key-2026-07-14.key" opc@129.213.191.36
   sudo systemctl stop gunicorn
   ```

2. Edit `~/picking-up/backend/.env` on the VM: comment out
   `ORACLE_DB_USER`/`ORACLE_DB_PASSWORD`/`ORACLE_DB_DSN` (comment, don't
   delete — needed for rollback in Phase D), add:
   ```
   DATABASE_URL=<neon-direct-connection-string>?sslmode=require
   ```
   `chmod 600 ~/picking-up/backend/.env` was already set per the original
   runbook — re-confirm it's still `600` after editing.

3. On the VM, against the now-active Neon connection, build the schema:
   ```
   cd ~/picking-up/backend
   .venv/bin/python manage.py migrate
   ```

4. Restart gunicorn and smoke test exactly as in the original runbook's
   [Step 11](../planning/7.%20deployment-runbook.md#L274-L294):
   ```
   sudo systemctl start gunicorn
   curl -H "Host: pickingup.duckdns.org" -i http://127.0.0.1:8000/api/tasks/
   ```
   Expect `401 Unauthorized` (proves Django/DRF is up), then from your own
   machine hit `https://pickingup.duckdns.org/api/tasks/` and walk the full
   browser flow: register a (new) account, log in, create/edit/delete a
   task, reload. There's no old data to check for — this is verifying the
   app works end-to-end against Neon in production, not data continuity.

---

## Phase D — Rollback plan

If Phase C's smoke test fails: **do not debug against live traffic.**
```
sudo systemctl stop gunicorn
```
Then in `~/picking-up/backend/.env`, uncomment `ORACLE_DB_USER`/
`ORACLE_DB_PASSWORD`/`ORACLE_DB_DSN` and comment out `DATABASE_URL` again,
then:
```
sudo systemctl start gunicorn
```
Oracle was never touched during Phase C (only read from, via `dumpdata`),
so this instantly restores the exact pre-cutover state. Keep the Oracle vars
in `.env` (commented, not deleted) and keep the Oracle Autonomous DB
instance running for at least a couple of weeks of stable Neon operation
before considering it safe to remove — it's Always Free, so there's no cost
pressure to decommission it quickly.

---

## Phase E — Cleanup (after a burn-in period, not immediately)

Only do this once Neon has been the live production DB for a stretch (e.g.
1–2 weeks) with no rollback needed:

1. Remove the Oracle branch from
   [`backend/config/settings.py:90-102`](../../backend/config/settings.py#L90-L102)
   (delete the `ORACLE_DB_USER`/`PASSWORD`/`DSN` block and its `if` branch;
   `DATABASE_URL` becomes the primary path, SQLite stays as the local
   no-`.env` fallback).
2. Remove `oracledb>=3.0,<4.0` from `backend/requirements.txt` and
   `.venv/bin/pip uninstall oracledb` locally.
3. Update [`docs/planning/6. oracle-database.md`](../planning/6.%20oracle-database.md)
   with a note that it's superseded by this migration, rather than deleting
   it — it documents real history (wallet setup, the `pickingup_app` DB
   user, etc.) that's still useful context.
4. Decide whether to terminate the Oracle Autonomous DB instance in the OCI
   console. It's free either way, so this is purely a tidiness call, not a
   cost or urgency one.

## Follow-up tasks checklist

- [x] Phase A: local Django migrates and runs cleanly against empty Neon
      (2026-08-08 — `check` clean, 44/44 migrations applied, full
      `apps.accounts`/`apps.tasks` suite: 193/193 tests passing against Neon)
- [ ] Latency comparison run (Oracle vs Neon, from the OCI VM — needs the
      `key/ssh-key-2026-07-14.key` access this machine doesn't have; run from
      the Windows dev setup instead. Local-machine-to-Neon reference point
      only: ~245ms cold, ~27ms warm per round trip — not representative of
      VM→Neon since the VM is presumably much closer to Neon's region)
- [x] Phase B: SKIPPED — decided 2026-08-08, no data migration, Neon starts
      empty
- [ ] Phase C: production cutover during a maintenance window (simplified —
      no data export/import)
- [ ] Phase D rollback plan understood and `.env` keeps Oracle vars commented
- [ ] Phase E cleanup done after burn-in (settings.py, requirements.txt, docs)

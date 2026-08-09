# Cloud Run Deployment Plan: Backend → Google Cloud Run

**Goal:** Move backend hosting from the OCI Always-Free VM to Google Cloud
Run, keeping Neon as the database (already in place per
[`postgres-migration-plan.md`](postgres-migration-plan.md)).

**Update, 2026-08-08 (supersedes the original approach below):** switched
from a buildpacks source deploy (`gcloud run deploy --source .`) to a
hand-written Dockerfile, built via Cloud Build and stored in Artifact
Registry. Reasoning: buildpacks hide exactly how the container gets built,
and the point of doing this deploy manually (vs. e.g. Vercel-style
auto-deploy) is to actually understand and be able to explain the
image-build-and-deploy pipeline — not just "I used Docker," but how a
production image is actually built, stored, and run. GitHub Actions /
OIDC-based CI/CD is deliberately deferred to a later phase, after this
manual flow is understood end to end.

**Target architecture:**
```
Django source (backend/)
    │
    ▼
Dockerfile ──── local `docker build` + `docker run` test
    │
    ▼
Cloud Build (gcloud builds submit)
    │
    ▼
Artifact Registry (us-east4-docker.pkg.dev/PROJECT_ID/picking-up/backend)
    │
    ▼
Cloud Run (picking-up-api)
    │  PostgreSQL (pooled)
    ▼
Neon
```
Vercel/Next.js sits in front of this once the Cloud Run URL exists — not
part of this phase.

**Why build via Cloud Build, not `docker build` + `docker push` locally:**
Apple Silicon Macs build `arm64` images by default; Cloud Run requires
`linux/amd64`. `gcloud builds submit` builds the image on GCP infrastructure
directly from the Dockerfile, sidestepping the architecture mismatch
entirely (the alternative — local `docker build --platform linux/amd64`
then `docker push` — works too, but Cloud Build is simpler and is what's
used here).

**Region choice:** `us-east4` (Northern Virginia) — co-located with Neon's
`us-east-1` (AWS N. Virginia), same latency reasoning as the DB migration
doc's OCI-VM/Neon proximity note.

---

## Status

**Live in production as of 2026-08-09:**
`https://picking-up-api-723438086234.us-east4.run.app`

Everything in this doc is done: `/api/health/`, the Dockerfile (built and
verified locally, then again via Cloud Build), the Artifact Registry repo,
the Cloud Run service itself, and a full register→login→create-task smoke
test against production. `backend/Procfile` from the earlier buildpacks
attempt is unused now — harmless to leave, but Cloud Run runs the image's
own `CMD`, not a Procfile.

Remaining work is everything in "Explicitly deferred" below — none of it
blocks the current deploy.

---

## Code changes already done (still valid)

- `backend/config/views.py` + `backend/config/test_views.py`: `GET
  /api/health/`, a plain Django view (not DRF) so it sits outside the
  project's default `IsAuthenticated` permission — infra health checks
  can't authenticate. TDD'd: test written and run failing (404) before the
  view existed.
- `backend/config/urls.py`: wired `path("api/health/", health, name="health")`.
- **No `settings.py` changes.** `DEBUG`, `SECRET_KEY`, `ALLOWED_HOSTS`,
  `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `DATABASE_URL`,
  `GOOGLE_OAUTH_CLIENT_ID` are already environment-driven via
  `django-environ` — confirmed by reading the file, not assumed. Still
  true for the Dockerfile approach; a container just needs these injected
  as env vars at `docker run`/Cloud Run deploy time.
- `requirements.txt` — already has `gunicorn` and `psycopg[binary]`; the
  Dockerfile installs from this file, no new dependency file needed.

Verified locally against the same Neon `production` branch already in use:
```
python manage.py check                             # clean
python manage.py makemigrations --check --dry-run   # clean
python manage.py test apps.accounts apps.tasks config  # 206/206 — matches CI's exact invocation
```

---

## Dockerfile (done, 2026-08-08)

`backend/Dockerfile`:
- Base image `python:3.12-slim`, matching
  [`backend/.python-version`](../../backend/.python-version) (pinned to
  `3.12.12`) and CI's `setup-python` config
  ([`.github/workflows/ci.yml:33`](../../.github/workflows/ci.yml#L33)) —
  not bumped to a newer minor version.
- Installs from `backend/requirements.txt` (the project's existing, only
  dependency file), copied and installed before the rest of the source so
  the dependency layer caches across code-only changes.
- Runs `collectstatic` **at build time**, baking static assets into the
  image (immutable-revision friendly, no per-cold-start cost). This needs
  Django to boot, which needs `DEBUG=True` or a real `DJANGO_SECRET_KEY` +
  `DJANGO_NUM_PROXIES` (`config/settings.py`'s startup checks) — neither
  exists at build time, so a placeholder `DJANGO_DEBUG=True
  DJANGO_SECRET_KEY=docker-build-time-only-not-a-real-secret` is scoped to
  just that one `RUN` instruction, not baked into the final image's
  environment.
- Runs as a non-root `appuser` (`useradd --uid 1000`, `chown -R` before
  `USER appuser`) — needed so the app can still write to
  `DJANGO_CACHE_LOCATION`'s default (`BASE_DIR / ".cache"`) at runtime.
- `CMD exec gunicorn --bind 0.0.0.0:$PORT config.wsgi:application` — shell
  form (not JSON array) so `$PORT` expands at container start; `exec`
  replaces the shell with gunicorn as PID 1 so it receives `SIGTERM`
  directly from Cloud Run for graceful shutdown. (Docker's linter flags
  shell-form `CMD` as non-recommended for signal handling — the `exec`
  prefix is precisely what addresses that concern; this is the same
  pattern Google's own Cloud Run Python quickstarts use.)
- **No `manage.py migrate` anywhere in the image or its startup command.**
  Cloud Run can scale to multiple instances; several containers all
  running `migrate` on boot would race each other. Future schema changes
  against Neon run as a separate, deliberate one-off step (e.g. a Cloud
  Run Job) — matching `postgres-migration-plan.md`'s Phase E notes.
- **No secrets baked in.** `.dockerignore` excludes `.env*`, and nothing
  in the Dockerfile `COPY`s or hardcodes `DATABASE_URL`/`DJANGO_SECRET_KEY`
  — both stay environment-driven, injected at `docker run`/Cloud Run
  deploy time.

`backend/.dockerignore`: excludes `.venv/`, `.git/`, `__pycache__/`,
`.env`/`.env.development`/`.env.local`/`.env.production`, `db.sqlite3`,
`staticfiles/`, `logs/`, `.cache/`, `key/`, `.pytest_cache/`.

---

## Local Docker verification (done, 2026-08-08)

```
cd backend
docker build -t picking-up-api .
docker run --rm -d --name picking-up-api-test \
  -p 8080:8080 \
  --env-file .env.development \
  -e PORT=8080 \
  picking-up-api
```
Results:
- `docker build`: succeeded — 154 static files collected, 444
  post-processed, image built and tagged.
- `curl http://localhost:8080/api/health/` → `200 {"status": "ok"}`.
- `curl http://localhost:8080/api/tasks/` → `401 Unauthorized` (DRF's auth
  stack responding correctly, not a connection error — same "success"
  signal the OCI runbook's own smoke test uses).
- `docker exec picking-up-api-test python manage.py shell -c "..."` running
  a real `SELECT 1` against `connection` → reached Neon successfully
  (`vendor: postgresql`), confirming the container's `DATABASE_URL` (from
  `.env.development`, pointed at Neon since Phase A) actually works from
  inside an isolated container, not just on the host.
- `docker exec picking-up-api-test whoami` → `appuser` (confirmed non-root).
- `docker stop picking-up-api-test` — cleaned up, no leftover container.

This confirms the image is correct and reaches the real Neon database from
inside a container isolated from the host machine — not yet talking to
Cloud Run, just proving the image itself is production-correct before
anything gets pushed to Artifact Registry.

---

## Prerequisites (done, 2026-08-09)

```
brew install --cask google-cloud-sdk   # gcloud wasn't installed on this machine
gcloud auth login                      # logged in as hoon7589@gmail.com
```
`gcloud projects list` showed an existing project, `jfloww-picking-up`
(project number `723438086234` — matches the Google OAuth client ID already
in use, confirming it's the right one):
```
gcloud config set project jfloww-picking-up
```

Billing wasn't linked to the project yet — `gcloud services enable`
initially failed with `FAILED_PRECONDITION`/`UREQ_PROJECT_BILLING_NOT_FOUND`.
Fixed by linking a billing account via
[console.cloud.google.com/billing](https://console.cloud.google.com/billing)
(needs a card on file even though this app's usage stays within the free
tier). Then:
```
gcloud services enable cloudbuild.googleapis.com artifactregistry.googleapis.com run.googleapis.com
```

Artifact Registry repository:
```
gcloud artifacts repositories create picking-up \
  --repository-format=docker \
  --location=us-east4
```

---

## Build and deploy (done, 2026-08-09)

**Gotcha hit and fixed:** the first `gcloud builds submit` uploaded 89 MiB /
6695 files — `gcloud` reads `.gcloudignore`, not `.dockerignore`, so
without one it fell back to including `.venv/`. Added `backend/.gcloudignore`
(same exclusions as `.dockerignore`) before rebuilding.

**Gotcha hit and fixed:** the very first submit also hit
`PERMISSION_DENIED` uploading to the `gs://jfloww-picking-up_cloudbuild`
source bucket — a one-time race from that bucket being auto-created on
first use right after enabling the API. Retried a few seconds later and it
worked; no permissions were actually missing (the account is project
Owner).

Build:
```
cd backend
gcloud builds submit \
  --tag us-east4-docker.pkg.dev/jfloww-picking-up/picking-up/backend:latest
```
Reads the Dockerfile directly — no buildpacks involved. Succeeded, image
pushed to Artifact Registry.

Deploy:
```
gcloud run deploy picking-up-api \
  --image us-east4-docker.pkg.dev/jfloww-picking-up/picking-up/backend:latest \
  --region us-east4 \
  --allow-unauthenticated \
  --cpu=1 --memory=512Mi --min-instances=0 --max-instances=3 \
  --env-vars-file=<local YAML file, outside the repo, deleted after use>
```
**Service URL: `https://picking-up-api-723438086234.us-east4.run.app`**

Each deploy creates a new **immutable** Cloud Run revision from that exact
image — re-running `gcloud builds submit` with a new tag/digest and
re-deploying is how updates ship, not mutating a running container.

---

## Environment variables for the Cloud Run service (done, 2026-08-09)

Set via `gcloud run deploy --env-vars-file=<path>.yaml`, pointing at a YAML
file written outside the repo (in a scratch directory, deleted immediately
after the deploy succeeded) rather than Cloud Console's UI as originally
planned — same goal (keep `DATABASE_URL`/`DJANGO_SECRET_KEY` out of shell
history/`gcloud` CLI args), different mechanism; either works.

```
DATABASE_URL: "<Neon POOLED connection string>&channel_binding=require"
DJANGO_SECRET_KEY: "<freshly generated via get_random_secret_key()>"
DJANGO_DEBUG: "False"
DJANGO_ALLOWED_HOSTS: "*"            # first deploy only — tightened below once URL was known
DJANGO_NUM_PROXIES: "1"              # REQUIRED — see below
GOOGLE_OAUTH_CLIENT_ID: "<existing OAuth client ID>"
```

**`DJANGO_NUM_PROXIES=1` is not optional.**
[`backend/config/settings.py:174-181`](../../backend/config/settings.py#L174-L181)
raises `ImproperlyConfigured` at startup if `DJANGO_DEBUG=False` and this is
unset/`0` — without it, every request's client IP collapses to Google's
front-end proxy address, and every user shares one auth-throttle bucket.
Cloud Run sits behind Google's own front-end the same way nginx does on the
OCI VM, so `1` is the right value. Confirmed correct: the first deploy
booted successfully and `/api/health/` returned `200` immediately.

**Used Neon's pooled connection string** (`-pooler` in the hostname), not
the direct one used for the OCI VM in `postgres-migration-plan.md`. Cloud
Run can run multiple instances concurrently — exactly the scenario Neon's
PgBouncer pooling is for.

**Follow-up done same day:** once the real service URL was known, narrowed
`DJANGO_ALLOWED_HOSTS` from `*` to
`picking-up-api-723438086234.us-east4.run.app` and added
`DJANGO_CSRF_TRUSTED_ORIGINS=https://picking-up-api-723438086234.us-east4.run.app`
via:
```
gcloud run services update picking-up-api --region us-east4 \
  --update-env-vars="DJANGO_ALLOWED_HOSTS=picking-up-api-723438086234.us-east4.run.app,DJANGO_CSRF_TRUSTED_ORIGINS=https://picking-up-api-723438086234.us-east4.run.app"
```
Re-verified `/api/health/` still `200` after this revision.

---

## Known gap, deliberately not fixed here: throttle cache isn't shared across instances

[`backend/config/settings.py:150-152`](../../backend/config/settings.py#L150-L152)
already comments on this: production's cache is `FileBasedCache`, correct
for the OCI VM where every gunicorn worker shares one disk, but each Cloud
Run instance gets its own ephemeral filesystem. With `max-instances: 2~3`,
DRF's login/register/Google-auth throttles (`DEFAULT_THROTTLE_RATES`) would
apply per-instance, not globally — a real but minor gap for a low-traffic
personal app, not a crash.

Two options, not yet decided:
- Leave it and track as a follow-up (same category as the OCI runbook's own
  deferred items) — simplest, matches "ship the first deploy" scope.
- Set `max-instances: 1` for now to keep today's single-instance guarantee
  until a shared cache (e.g. Upstash Redis free tier) is worth adding.

---

## Cloud Run resource settings (first deploy)

```
CPU:            1
Memory:         512 MiB
Min instances:  0        # scale-to-zero when idle
Max instances:  2-3      # blast-radius cap against runaway scaling
Concurrency:    default
```

---

## Post-deploy verification (done, 2026-08-09)

```
curl https://picking-up-api-723438086234.us-east4.run.app/api/health/
```
→ `200 {"status": "ok"}`.

Full write-path smoke test via `curl` (register → login → create task),
using a throwaway account, deleted afterward:
```
POST /api/auth/register/  -> 201
POST /api/auth/token/     -> 200, access + refresh tokens issued
POST /api/tasks/          -> 201, task persisted with the client-supplied id
```
Confirmed via `manage.py shell` against Neon directly: the smoke-test
user (`id=2`) and its task were created, then deleted
(`User.objects.filter(...).delete()` cascaded: 1 task + 1 user removed).
The real account already in Neon since local testing (`id=1`,
`hoon7589@gmail.com`, created 2026-08-08) was left untouched.

This confirms the full path — Cloud Run container → Neon (pooled
connection) — works for both reads and writes in production, not just the
health check.

## Frontend wired to Cloud Run (done, 2026-08-09)

No Vercel project existed yet for this app, so it was created from scratch:
```
npm install -g vercel
vercel login                    # device-code browser auth, account "jfloww"
cd frontend
vercel link --yes               # created project jflowws-projects/frontend
```
Production env vars set via `vercel env add <NAME> production`:
```
DJANGO_API_BASE_URL       = https://picking-up-api-723438086234.us-east4.run.app
NEXT_PUBLIC_GOOGLE_CLIENT_ID = <existing OAuth client ID>
NEXT_PUBLIC_APP_NAME      = Picking Up
```
Deployed: `vercel --prod` →
**`https://frontend-liard-seven-91.vercel.app`**

Verified the full chain for real, not just that each piece boots:
```
curl https://frontend-liard-seven-91.vercel.app/login          -> 200
curl -X POST .../api/auth/register (via the frontend's own BFF route)
                                                                  -> 201, user id 3
```
Confirms Vercel's Next.js server → its `/api/auth/*` route handlers →
Cloud Run → Neon all actually work together, not just each piece in
isolation. Test account deleted afterward the same way as the earlier
Cloud Run-only smoke test.

Backend `DJANGO_CORS_ALLOWED_ORIGINS` updated to the real Vercel origin
(defense-in-depth only — the browser never calls Django directly in this
architecture, Next.js's server-side BFF does, same reasoning as the OCI
runbook's own CORS step).

**Still needs manual action (Google Cloud Console, not CLI-manageable):**
add `https://frontend-liard-seven-91.vercel.app` to the OAuth client's
**Authorized JavaScript origins**, or Google Sign-In will fail on this
domain even though the email/password path already works.

## Explicitly deferred

- GitHub Actions / OIDC / Workload Identity Federation for automatic
  CI/CD — the manual `gcloud builds submit` + `gcloud run deploy` flow
  above is what this would eventually replace, once it's well understood.
- Cloud Build triggers (auto-build on push).
- Custom domain (DuckDNS's role on the OCI VM has no Cloud Run equivalent
  yet — using the `*.run.app`/`*.vercel.app` URLs directly for now).
- Shared cache for cross-instance throttle correctness (see above).
- Decommissioning the OCI VM once Cloud Run is confirmed stable.

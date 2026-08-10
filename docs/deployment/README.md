# Deployment Guide

The current, working procedure for deploying and updating picking-up.
This is the "how to operate it" reference — for the "why we ended up here"
history (Oracle → Neon, buildpacks → Dockerfile, etc.), see
`docs/db-migration/` and `docs/develop-history/`.

## Current architecture

```
Vercel (Next.js, jflowws-projects/frontend)
    │ HTTPS, server-side only (DJANGO_API_BASE_URL)
    ▼
Google Cloud Run (Django + gunicorn, project jfloww-picking-up, us-east4)
    │ PostgreSQL, pooled connection
    ▼
Neon (production branch, AWS us-east-1)
```

| Piece | Where | Current URL / identifier |
|---|---|---|
| Frontend | Vercel | `https://frontend-liard-seven-91.vercel.app` |
| Backend | Cloud Run, project `jfloww-picking-up`, region `us-east4` | `https://picking-up-api-723438086234.us-east4.run.app` |
| Backend image | Artifact Registry | `us-east4-docker.pkg.dev/jfloww-picking-up/picking-up/backend` |
| Database | Neon, project region AWS `us-east-1` | branch `production` |

The old OCI VM + Oracle Autonomous DB stack (`docs/planning/7. deployment-runbook.md`)
is still running, untouched, not yet decommissioned.

---

## 1. Frontend (Vercel)

**Stack:** Next.js, deployed via the Vercel CLI (no Git auto-deploy
configured — deploys are manual, matching the "manual first, CI/CD later"
approach used for the backend too).

**Prerequisites:**
```
npm install -g vercel     # if not already installed
vercel login               # browser device-code auth
```
Run from `frontend/` — the project is already linked there
(`frontend/.vercel/` — gitignored, holds the project link).

**Environment variables** (Vercel dashboard, or `vercel env ls`):
```
DJANGO_API_BASE_URL          = https://picking-up-api-723438086234.us-east4.run.app
NEXT_PUBLIC_GOOGLE_CLIENT_ID = 723438086234-jn40gdcdj5a8cva3b34k401hc26hd8s0.apps.googleusercontent.com
NEXT_PUBLIC_APP_NAME         = Picking Up
```
`DJANGO_API_BASE_URL` is server-side only (no `NEXT_PUBLIC_` prefix) —
the browser never calls Django directly, Next.js's own server-side route
handlers (the BFF layer) do. `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is
intentionally public; Google enforces the real security boundary via
Authorized JavaScript origins, not secrecy of the client ID.

**Unverified: `VERCEL_GIT_COMMIT_SHA` on manual CLI deploys.** The footer
and `/diagnostics` read this Vercel-provided system env var to show the
deployed commit. Vercel documents it as automatically populated, but that
guarantee is normally described for Git-integrated deploys (push-to-deploy);
this project deploys via `vercel --prod` from the CLI with no Git
auto-deploy configured, and that combination has not actually been
verified. It fails gracefully today — the footer just omits the SHA and
`/diagnostics` shows "unknown" — so this is not worth a speculative code
fix. Verify on the next real Vercel deploy by checking `/diagnostics`
afterward; if the SHA is missing, add a manually-set build-time env var
(e.g. `NEXT_PUBLIC_COMMIT_SHA` populated from `git rev-parse --short HEAD`
at deploy time) as a fallback then, not before.

**Deploy:**
```
cd frontend
vercel --prod
```
Builds and deploys the current working directory straight to production.
No confirmation step — this goes live immediately on completion.

**Change an env var:**
```
vercel env rm <NAME> production      # if it already exists
printf '%s' "<value>" | vercel env add <NAME> production
vercel --prod                        # redeploy — env var changes need a new deployment to take effect
```

---

## 2. Backend (Cloud Run)

**Stack:** Django + gunicorn, containerized via `backend/Dockerfile`, built
on Cloud Build (not locally — this machine is Apple Silicon/`arm64`, Cloud
Run needs `linux/amd64`), stored in Artifact Registry, run on Cloud Run.

**Prerequisites:**
```
gcloud auth login
gcloud config set project jfloww-picking-up
```
Docker Desktop running, only if testing the image locally first (recommended
before pushing anything, see below).

**Local verification before every deploy** (catches breakage before it's
live):
```
cd backend
docker build -t picking-up-api .
docker run --rm -d --name picking-up-api-test -p 8080:8080 \
  --env-file .env.development -e PORT=8080 picking-up-api
curl http://localhost:8080/api/health/      # expect 200 {"status": "ok", "service": "picking-up-api", "version": ..., "commit": ..., "environment": ...}
docker stop picking-up-api-test
```

**Build the image on Cloud Build:**
```
cd backend
gcloud builds submit \
  --tag us-east4-docker.pkg.dev/jfloww-picking-up/picking-up/backend:latest
```
Reads `backend/Dockerfile` directly, no buildpacks. Respects
`backend/.gcloudignore` (not `.dockerignore` — `gcloud` doesn't read that
one; keep both in sync if excluded paths ever change).

**Deploy that image:**
```
gcloud run deploy picking-up-api \
  --image us-east4-docker.pkg.dev/jfloww-picking-up/picking-up/backend:latest \
  --region us-east4
```
Creates a new **immutable** revision and routes 100% of traffic to it once
healthy. `--allow-unauthenticated`, `--cpu`, `--memory`, `--min-instances`,
`--max-instances` only need to be repeated if you want to *change* them —
Cloud Run carries forward the current service configuration otherwise.

**Environment variables** (Cloud Console → Cloud Run → `picking-up-api` →
Edit & deploy new revision → Variables & Secrets, or
`gcloud run services describe picking-up-api --region us-east4` to view):
```
DATABASE_URL              = <Neon POOLED connection string>&channel_binding=require
DJANGO_SECRET_KEY         = <production secret — do not reuse the local dev one>
DJANGO_DEBUG              = False
DJANGO_ALLOWED_HOSTS      = picking-up-api-723438086234.us-east4.run.app
DJANGO_CSRF_TRUSTED_ORIGINS = https://picking-up-api-723438086234.us-east4.run.app
DJANGO_NUM_PROXIES        = 1
GOOGLE_OAUTH_CLIENT_ID    = 723438086234-jn40gdcdj5a8cva3b34k401hc26hd8s0.apps.googleusercontent.com
DJANGO_CORS_ALLOWED_ORIGINS = https://frontend-liard-seven-91.vercel.app
DJANGO_GIT_SHA            = <short commit SHA of the deployed image, e.g. $(git rev-parse --short HEAD)>
DJANGO_ENVIRONMENT        = production
```
`DJANGO_GIT_SHA` and `DJANGO_ENVIRONMENT` feed `/api/health`'s `commit` and
`environment` fields — both default to `"unknown"` when unset, so a deploy
that forgets them fails honestly instead of reporting a wrong value.

**`DJANGO_NUM_PROXIES=1` is required, not optional** —
`backend/config/settings.py:174-181` refuses to start (`ImproperlyConfigured`)
without it when `DJANGO_DEBUG=False`. Cloud Run sits behind Google's own
front-end proxy the same way nginx did on the OCI VM.

**Change an env var (without a new image build):**
```
gcloud run services update picking-up-api --region us-east4 \
  --update-env-vars="KEY=value,KEY2=value2"
```
Prefer this over the CLI for non-secret values only; for `DATABASE_URL`/
`DJANGO_SECRET_KEY`, use a local YAML file passed via
`--env-vars-file=<path>` (outside the repo, delete after use) or the Cloud
Console UI — either keeps secrets out of shell history.

---

## 3. Database (Neon)

**Stack:** Neon PostgreSQL, `production` branch, AWS `us-east-1`. No local
Postgres, no Docker DB container — both local dev and Cloud Run point at
the same Neon project (different connection strings, see below).

**Two connection strings, used in different places:**
- **Direct** (no `-pooler` in the hostname) — used for local dev
  (`backend/.env.development`). Fine for a single long-lived local
  connection.
- **Pooled** (`-pooler` in the hostname, PgBouncer) — used for Cloud Run's
  `DATABASE_URL`. Cloud Run can run multiple instances concurrently;
  pooling is exactly what that scenario needs, unlike a single long-lived
  local process.

Get either from the Neon dashboard → project → **Connect**.

**Schema migrations — deliberately manual, never automatic on deploy.**
Cloud Run's container `CMD` does **not** run `manage.py migrate` (see
`backend/Dockerfile`'s comment) — if it did, every concurrent container
start would race the same migration against Neon. Instead, run migrations
as a distinct, deliberate step, from your local machine, pointed at the
same Neon branch Cloud Run uses:
```
cd backend
# Ensure backend/.env.development's DATABASE_URL points at the same Neon
# branch Cloud Run uses (it already does — same "production" branch).
python manage.py migrate
```
Do this **before** deploying backend code that depends on the new schema,
or as part of the same release window — not after. For anything beyond an
additive migration (renames, drops, non-nullable columns without a
default), use an expand/contract release the same way the OCI runbook
already documented, since old and new code may briefly run against the
schema at the same time.

**Backups:** Neon takes automatic backups/point-in-time recovery on its
own (see Neon's dashboard for retention on the current plan) — nothing
project-specific configured beyond what Neon does by default.

---

## 4. Updating an already-deployed piece

**Frontend code change:**
```
cd frontend
vercel --prod
```
That's the entire update procedure — no build artifacts to manage, no
versioning beyond what Vercel tracks itself.

**Backend code change (no schema change):**
```
cd backend
gcloud builds submit --tag us-east4-docker.pkg.dev/jfloww-picking-up/picking-up/backend:latest
gcloud run deploy picking-up-api --image us-east4-docker.pkg.dev/jfloww-picking-up/picking-up/backend:latest --region us-east4 \
  --update-env-vars=DJANGO_GIT_SHA=$(git rev-parse --short HEAD),DJANGO_ENVIRONMENT=production
```
Always run the local Docker verification (`docker build && docker run` +
`curl /api/health/`) before the Cloud Build submit, same as a first
deploy — catches breakage before it reaches Cloud Run at all.
Passing `DJANGO_GIT_SHA` on every deploy keeps `/api/health`'s `commit`
field honest — otherwise it silently reports whatever SHA was set on the
last deploy that remembered to pass it.

**Backend code change (with a schema change):**
```
# 1. Run the new migration against Neon first
cd backend
python manage.py migrate

# 2. Then build and deploy the new code as above
gcloud builds submit --tag us-east4-docker.pkg.dev/jfloww-picking-up/picking-up/backend:latest
gcloud run deploy picking-up-api --image us-east4-docker.pkg.dev/jfloww-picking-up/picking-up/backend:latest --region us-east4 \
  --update-env-vars=DJANGO_GIT_SHA=$(git rev-parse --short HEAD),DJANGO_ENVIRONMENT=production
```
If the migration isn't backward-compatible with the *currently running*
revision, use an expand/contract split instead of one migration + one
deploy — Cloud Run's rollout isn't instantaneous, so old and new revisions
can briefly overlap.

**Rolling back a bad backend deploy:**
```
gcloud run revisions list --service picking-up-api --region us-east4
gcloud run services update-traffic picking-up-api --region us-east4 \
  --to-revisions=<previous-revision-name>=100
```
Revisions are immutable and kept around — rollback is re-routing traffic,
not rebuilding anything.

**Rolling back a bad frontend deploy:**
```
vercel ls                        # list recent deployments
vercel promote <deployment-url>  # re-promote an earlier one to production
```

**Env var / secret rotation:** see the "Change an env var" subsections in
sections 1 and 2 above.

---

## Not yet set up (intentionally deferred)

- Auto-deploy on git push, for either Vercel or Cloud Run — everything
  above is a manual CLI step by design, until the manual flow is well
  understood (see `docs/db-migration/cloud-run-deployment.md`'s reasoning).
- CI/CD via GitHub Actions / OIDC / Workload Identity Federation.
- Custom domains — using `*.run.app` and `*.vercel.app` directly.
- A shared cache for Cloud Run's auth throttles if `max-instances` is ever
  raised past what a single instance's local file cache can correctly
  rate-limit (see `docs/db-migration/cloud-run-deployment.md`).
- OCI VM decommission — still running the old stack as a fallback.

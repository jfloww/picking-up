# Development History: First Live Cloud Run Deploy

## Date

2026-08-09

## Goal

Actually deploy the Dockerized backend (from `004-dockerize-backend.md`) to
Google Cloud Run, using Neon as the database. Full plan/details:
`docs/db-migration/cloud-run-deployment.md`.

## Result

**Live:** `https://picking-up-api-723438086234.us-east4.run.app`

## Work Completed

GCP setup:
- `gcloud` CLI wasn't installed on this machine — installed via
  `brew install --cask google-cloud-sdk`.
- `gcloud auth login` — logged in as `hoon7589@gmail.com`.
- Found an existing project, `jfloww-picking-up` (project number
  `723438086234`, matching the Google OAuth client ID already in use) —
  set as active project.
- Billing wasn't linked yet; `gcloud services enable` failed with
  `FAILED_PRECONDITION`/`UREQ_PROJECT_BILLING_NOT_FOUND` until the user
  linked a billing account via Cloud Console.
- Enabled `cloudbuild`, `artifactregistry`, `run` APIs.
- Created the Artifact Registry repo `picking-up` in `us-east4`.

Build and deploy:
- `gcloud builds submit --tag us-east4-docker.pkg.dev/jfloww-picking-up/picking-up/backend:latest`
  — first attempt hit `PERMISSION_DENIED` uploading to the Cloud Build
  source bucket (one-time race from the bucket being auto-created on first
  use), succeeded on retry.
- Added `backend/.gcloudignore` (new) after noticing the first upload was
  89 MiB / 6695 files — `gcloud` reads `.gcloudignore`, not `.dockerignore`,
  so `.venv/` had been included.
- `gcloud run deploy picking-up-api --image ... --region us-east4 --allow-unauthenticated --cpu=1 --memory=512Mi --min-instances=0 --max-instances=3 --env-vars-file=<scratch path>.yaml`
  — env vars written to a YAML file outside the repo (scratch directory,
  deleted after use) rather than typed into Cloud Console's UI as
  originally planned; same goal (secrets never touch shell history/`gcloud`
  args), different mechanism.
- Env vars set: `DATABASE_URL` (Neon **pooled** connection string, not the
  direct one used for local dev/OCI), a freshly generated
  `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=False`, `DJANGO_ALLOWED_HOSTS=*`
  (temporary), `DJANGO_NUM_PROXIES=1` (required — see
  `004`/`cloud-run-deployment.md` for why), `GOOGLE_OAUTH_CLIENT_ID`.
- Follow-up same day, once the real URL was known: narrowed
  `DJANGO_ALLOWED_HOSTS` to the actual host and added
  `DJANGO_CSRF_TRUSTED_ORIGINS` via `gcloud run services update
  --update-env-vars`.

## Verification Performed

```text
curl https://picking-up-api-723438086234.us-east4.run.app/api/health/
-> 200 {"status": "ok"}
```

Full write-path smoke test via a throwaway account:
```text
POST /api/auth/register/  -> 201
POST /api/auth/token/     -> 200 (access + refresh tokens issued)
POST /api/tasks/          -> 201 (task persisted with client-supplied UUID id)
```
Confirmed directly against Neon via `manage.py shell`: the smoke-test user
(`id=2`) and its task existed, then were deleted (cascade: 1 task + 1
user). The real account already in Neon from local testing (`id=1`,
`hoon7589@gmail.com`, created 2026-08-08) was untouched throughout.

Re-verified `/api/health/` still `200` after the `ALLOWED_HOSTS`-narrowing
follow-up deploy.

## Current State

```text
Local dev backend  -> PostgreSQL (Neon)
Production backend -> Google Cloud Run (Dockerfile-built image), live,
                       serving 100% of traffic on revision picking-up-api-00002
                       -> Neon PostgreSQL (pooled connection)
OCI VM              -> still running the old Oracle-backed deployment,
                       not yet decommissioned
```

## Deferred / Next Steps

```text
1. Wire Vercel/frontend to the new Cloud Run URL (not done — deliberately
   deferred until this checklist above was fully green)
2. GitHub Actions / OIDC / Workload Identity Federation for CI/CD
3. Cloud Build triggers (auto-build on push)
4. Custom domain (currently using the *.run.app URL directly)
5. Shared cache for cross-instance throttle correctness if traffic ever
   justifies max-instances > 1 in practice
6. Decommission the OCI VM once Cloud Run is confirmed stable over time
```

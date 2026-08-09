# Development History: Dockerize Backend for Cloud Run

## Date

2026-08-08

## Goal

Containerize the Django backend for Google Cloud Run, replacing the
buildpacks-based source deploy planned in `003-cloud-run-backend-prep.md`.
Full plan: `docs/db-migration/cloud-run-deployment.md`.

## Decision

Switched from `gcloud run deploy --source .` (buildpacks) to a
hand-written Dockerfile, built via Cloud Build and stored in Artifact
Registry. Reasoning: buildpacks hide how the image actually gets built;
writing the Dockerfile directly means being able to explain the real
build/deploy pipeline, not just "I used Docker." GitHub Actions/OIDC-based
CI/CD stays deferred to a later phase, after this manual flow is
understood.

## Work Completed

Added:

```text
backend/Dockerfile        (new)
backend/.dockerignore     (new)
```

`backend/Procfile` (from `003`) is now unused for the deploy path — Cloud
Run runs the image's own `CMD`, not a Procfile — but was left in place
rather than deleted.

Dockerfile design decisions:

- `python:3.12-slim` base, matching `backend/.python-version` (3.12.12)
  and CI.
- `collectstatic` baked in at **build time** (not container startup, unlike
  the old Procfile) — needs a placeholder `DJANGO_DEBUG=True` +
  `DJANGO_SECRET_KEY` scoped to that one `RUN` instruction only, since
  `config/settings.py` refuses to boot with `DEBUG=False` and no real
  secret/`DJANGO_NUM_PROXIES` — neither exists at build time.
- Runs as non-root `appuser` (`chown -R` before `USER appuser`), needed so
  the app can still write `DJANGO_CACHE_LOCATION`'s default location at
  runtime.
- `CMD exec gunicorn --bind 0.0.0.0:$PORT config.wsgi:application` — shell
  form for `$PORT` expansion, `exec` so gunicorn becomes PID 1 and gets
  `SIGTERM` directly.
- No `manage.py migrate` anywhere (would race across concurrent Cloud Run
  instances). No secrets baked in — `.dockerignore` excludes all `.env*`
  files.

## Verification Performed

Docker Desktop wasn't running at the start of this session; started it and
waited for the daemon before proceeding.

```text
docker build -t picking-up-api .
```
Result: succeeded — 154 static files collected, 444 post-processed.

```text
docker run --rm -d --name picking-up-api-test -p 8080:8080 \
  --env-file .env.development -e PORT=8080 picking-up-api
```

```text
curl http://localhost:8080/api/health/       -> 200 {"status": "ok"}
curl http://localhost:8080/api/tasks/        -> 401 Unauthorized (DRF auth working, not a connection error)
docker exec ... manage.py shell (SELECT 1)   -> reached Neon, vendor: postgresql
docker exec ... whoami                       -> appuser (non-root confirmed)
docker stop picking-up-api-test              -> cleaned up
```

Confirms the image runs correctly in isolation from the host and reaches
the real Neon database (same `production` branch already in use since
Phase A) from inside the container.

## Current State

```text
Local dev backend  -> PostgreSQL (Neon)
Production backend -> Oracle Autonomous DB (OCI), unchanged
Docker image        -> builds and runs correctly locally, reaches Neon
                        Not yet pushed to Artifact Registry or deployed to
                        Cloud Run
```

## Deferred / Next Steps

Tracked in `docs/db-migration/cloud-run-deployment.md`:

```text
1. gcloud auth login / gcloud config set project <id>
2. gcloud artifacts repositories create picking-up --repository-format=docker --location=us-east4
3. gcloud builds submit --tag us-east4-docker.pkg.dev/PROJECT_ID/picking-up/backend:latest
4. gcloud run deploy picking-up-api --image ... --region us-east4 --allow-unauthenticated
5. Set env vars in Cloud Console (DATABASE_URL pooled, DJANGO_SECRET_KEY,
   DJANGO_DEBUG=False, DJANGO_ALLOWED_HOSTS=*, DJANGO_NUM_PROXIES=1,
   GOOGLE_OAUTH_CLIENT_ID)
6. Post-deploy verification: /api/health/, then full feature checklist
7. Still deferred: GitHub Actions/OIDC/WIF, Cloud Build triggers, custom
   domain, wiring Vercel to the new backend URL, shared throttle cache,
   OCI VM decommission
```

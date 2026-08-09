# Development History: Cloud Run Backend Prep

## Date

2026-08-08

## Goal

Prepare the Django backend for deployment to Google Cloud Run, without
migrating Oracle data and without touching the frontend/Vercel — a
follow-on decision after `002-postgres-migration-phase-a.md`, moving
backend compute off the OCI VM in addition to the database already moving
to Neon. Full plan: `docs/db-migration/cloud-run-deployment.md`.

## Decisions Made

- Source-based deploy (`gcloud run deploy --source .`, Cloud
  Build/buildpacks) for the first Cloud Run deploy, not a hand-written
  Dockerfile. Buildpacks read `requirements.txt` + a `Procfile`; a
  Dockerfile stays a later, separate option if more build control is
  needed.
- Region `us-east4` (Northern Virginia), co-located with Neon's AWS
  `us-east-1`.
- Neon's **pooled** connection string for Cloud Run (unlike the OCI VM,
  which uses the direct string) — Cloud Run's multi-instance scaling is
  exactly what PgBouncer pooling is for.
- Cloud Run resource settings for the first deploy: 1 CPU, 512 MiB,
  min-instances 0 (scale-to-zero), max-instances 2-3 (blast-radius cap).

## Work Completed

Confirmed via code reading — no `settings.py` changes were needed:
`DEBUG`, `SECRET_KEY`, `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`,
`CSRF_TRUSTED_ORIGINS`, `DATABASE_URL`, `GOOGLE_OAUTH_CLIENT_ID` were
already environment-driven via `django-environ`. `requirements.txt`
already had `gunicorn` and `psycopg[binary]`.

Added:

```text
backend/Procfile                    (new)
backend/config/views.py             (new — health view)
backend/config/test_views.py        (new — TDD'd: test written failing first)
backend/config/urls.py              (modified — wired GET /api/health/)
```

`Procfile`:
```text
web: python manage.py collectstatic --noinput && gunicorn --bind 0.0.0.0:$PORT config.wsgi:application
```

`GET /api/health/` is a plain Django view, not DRF — deliberately outside
the project's default `IsAuthenticated` permission, since infra health
checks can't authenticate.

Verification, run against the same Neon `production` branch already in use
from Phase A:

```text
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py test apps.accounts apps.tasks config
```

Result:

```text
System check identified no issues.
No changes detected.
Ran 206 tests, OK. (matches CI's exact `manage.py test` invocation)
```

## Gaps Flagged, Not Fixed (out of this session's scope)

1. **`DJANGO_NUM_PROXIES` must be set to `1` on Cloud Run.**
   `config/settings.py:174-181` raises `ImproperlyConfigured` at startup
   when `DJANGO_DEBUG=False` and this is unset — required or the container
   won't boot. Not in the user's original env var checklist; added to
   `docs/db-migration/cloud-run-deployment.md`.
2. **Throttle cache isn't shared across Cloud Run instances.**
   `config/settings.py:150-152`'s own comment already warns production's
   `FileBasedCache` assumes one shared disk (true on the OCI VM, false per
   Cloud Run instance). With `max-instances: 2-3`, DRF's auth throttles
   would apply per-instance, not globally. Documented as a known follow-up;
   not fixed (would need a shared cache like Redis, out of scope here).

## Current State

```text
Local dev backend  -> PostgreSQL (Neon)
Production backend -> Oracle Autonomous DB (OCI), unchanged — Cloud Run
                       deploy has not been run yet
```

## Deferred / Next Steps

Tracked in `docs/db-migration/cloud-run-deployment.md`:

```text
1. User runs: gcloud auth login / gcloud config set project <id>
2. User runs: gcloud run deploy picking-up-api --source . --region us-east4
   --allow-unauthenticated
3. Set env vars in Cloud Console (DATABASE_URL pooled, DJANGO_SECRET_KEY,
   DJANGO_DEBUG=False, DJANGO_ALLOWED_HOSTS=*, DJANGO_NUM_PROXIES=1,
   GOOGLE_OAUTH_CLIENT_ID)
4. Verify GET /api/health/, then the full feature checklist (register,
   login, Google sign-in, task/subtask/category/repeat CRUD)
5. Narrow DJANGO_ALLOWED_HOSTS / DJANGO_CSRF_TRUSTED_ORIGINS to the real
   *.run.app host once known
6. Still deferred: Dockerfile, CI/CD, custom domain, wiring Vercel to the
   new backend URL, shared throttle cache, OCI VM decommission
```

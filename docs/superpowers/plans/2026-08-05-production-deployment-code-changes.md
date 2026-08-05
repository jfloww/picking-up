# Production Deployment: Code Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two backend dependencies and settings changes needed for production (whitenoise-served static files, gunicorn as the WSGI server), so the backend is ready to run on the OCI VM per `docs/planning/7. deployment-runbook.md`.

**Architecture:** No new modules — `whitenoise.middleware.WhiteNoiseMiddleware` is inserted into the existing `MIDDLEWARE` list in `backend/config/settings.py`, `STATIC_ROOT`/`STORAGES` are added alongside the existing `STATIC_URL`, and `gunicorn`/`whitenoise` are added to `backend/requirements.txt`. `gunicorn` itself needs no settings — it's invoked directly against `config.wsgi:application` from the deployment runbook, not configured in Django.

**Tech Stack:** Django 5.1 (existing), `whitenoise` (new), `gunicorn` (new, deploy-only — not imported by any Django code).

## Global Constraints

- This plan covers **only** the code-side production readiness. VM provisioning, DuckDNS, certbot, systemd, nginx, Vercel, and Google Console changes are a separate manual runbook (`docs/planning/7. deployment-runbook.md`), not part of this plan.
- No behavior change in local dev: `DJANGO_DEBUG=True` locally never exercises whitenoise's manifest lookup in a way that breaks `runserver` (whitenoise no-ops gracefully when `collectstatic` hasn't been run — Django's dev server still serves static files itself via `django.contrib.staticfiles` when `DEBUG=True`, unaffected by whitenoise being in the middleware stack).
- `STORAGES` must define both the `"default"` and `"staticfiles"` keys — Django does not merge a partial `STORAGES` setting with its built-in defaults, so omitting `"default"` would silently break `FileField`/`ImageField` storage project-wide (this project doesn't use either today, but the setting must still be correct).
- Backend tests in this project run with Oracle env vars blanked to force the SQLite fallback (this machine's Oracle user lacks permission to create Django's throwaway test database) — same convention as every other backend test command in this repo's plans.

---

### Task 1: Whitenoise static files + gunicorn dependency

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/config/settings.py`
- Modify: `backend/.env.example`
- Test: `backend/apps/tasks/tests.py` (appended — `apps.tasks` is a registered Django app with an established discovery path; `config` is not an app, so a settings-level test lives here rather than in a new undiscoverable `config/tests.py`)

**Interfaces:**
- Produces: `whitenoise.middleware.WhiteNoiseMiddleware` present in `settings.MIDDLEWARE`, `settings.STATIC_ROOT` pointing at `backend/staticfiles`, `settings.STORAGES["staticfiles"]["BACKEND"] == "whitenoise.storage.CompressedManifestStaticFilesStorage"`. The deployment runbook's `collectstatic` step depends on all three existing exactly as named here.

- [ ] **Step 1: Write the failing tests**

Append to `backend/apps/tasks/tests.py`, at the very end of the file (after the last line of `CategoryApiTests`):

```python


class ProductionStaticFilesTests(SimpleTestCase):
    def test_whitenoise_middleware_runs_directly_after_security_middleware(self):
        security_index = settings.MIDDLEWARE.index("django.middleware.security.SecurityMiddleware")
        self.assertEqual(
            settings.MIDDLEWARE[security_index + 1],
            "whitenoise.middleware.WhiteNoiseMiddleware",
        )

    def test_static_root_is_configured(self):
        self.assertEqual(settings.STATIC_ROOT.name, "staticfiles")

    def test_staticfiles_storage_uses_whitenoise_compressed_manifest(self):
        self.assertEqual(
            settings.STORAGES["staticfiles"]["BACKEND"],
            "whitenoise.storage.CompressedManifestStaticFilesStorage",
        )

    def test_default_file_storage_is_still_explicitly_configured(self):
        # STORAGES is not deep-merged with Django's built-in defaults — if this
        # project ever adds a FileField/ImageField, an accidentally-omitted
        # "default" key here would silently misconfigure it project-wide.
        self.assertEqual(
            settings.STORAGES["default"]["BACKEND"],
            "django.core.files.storage.FileSystemStorage",
        )
```

Add `SimpleTestCase` to the existing `django.test` import at the top of the file (currently `from django.test import TestCase`), and add `from django.conf import settings` as a new import alongside it:

```python
from django.conf import settings
from django.test import SimpleTestCase, TestCase
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks.tests.ProductionStaticFilesTests -v 2`
Expected: FAIL — `ValueError` from `.index(...)` not finding whitenoise in `MIDDLEWARE` (test 1), `AttributeError`/`AssertionError` on `STATIC_ROOT`/`STORAGES` not existing yet (tests 2-4, since `STORAGES` isn't set in `settings.py` today at all).

- [ ] **Step 3: Add the dependencies**

In `backend/requirements.txt`, append after the existing `requests` line:

```
gunicorn>=23.0,<24.0
whitenoise>=6.7,<7.0
```

Install them into the local dev venv so the settings changes below actually import successfully: `cd backend && pip install -r requirements.txt`.

- [ ] **Step 4: Update settings.py**

In `backend/config/settings.py`, insert `"whitenoise.middleware.WhiteNoiseMiddleware"` into `MIDDLEWARE` directly after `"django.middleware.security.SecurityMiddleware"` (this exact position is required by whitenoise — it must run early, right after security middleware and before session/common middleware):

```python
MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
```

Replace the existing `STATIC_URL = "static/"` line with:

```python
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test apps.tasks.tests.ProductionStaticFilesTests -v 2`
Expected: PASS (4/4)

- [ ] **Step 6: Update the production block in `.env.example`**

In `backend/.env.example`, the existing commented-out block already says:

```
# --- Production (OCI Always Free VM) ---
# ...
# DJANGO_ALLOWED_HOSTS=<oci-vm-public-domain-or-ip>
# DJANGO_CORS_ALLOWED_ORIGINS=https://<vercel-domain>
```

Replace the `DJANGO_ALLOWED_HOSTS` line's placeholder to reflect the actual chosen mechanism (a DuckDNS hostname, not a raw IP or a purchased domain):

```
# DJANGO_ALLOWED_HOSTS=<your-duckdns-hostname>.duckdns.org
```

- [ ] **Step 7: Run the full backend test suite**

Run: `cd backend && ORACLE_DB_USER= ORACLE_DB_PASSWORD= ORACLE_DB_DSN= python manage.py test -v 2`
Expected: PASS — every existing test still passes (this change only adds middleware/settings that no existing test asserts against, plus the 4 new ones from Step 1).

- [ ] **Step 8: Commit**

```bash
git add backend/requirements.txt backend/config/settings.py backend/.env.example backend/apps/tasks/tests.py
git commit -m "feat: add whitenoise static files and gunicorn for production"
```

# Local Development Setup

Everything needed to run Picking Up (Next.js frontend + Django backend) on your machine. This covers **local development only** — production deployment is tracked separately in `docs/deployment/` and `docs/db-migration/`.

## Prerequisites

| Tool | Version used in this project | Notes |
|---|---|---|
| Node.js | 20.x | via `nvm` (recommended) or nodejs.org |
| npm | 10.x | ships with Node 20 |
| Python | 3.12 | via `pyenv` or python.org |
| Git | any recent version | |

No Docker, no Makefile, no CI config — just a Python venv and npm.

## Quick start

```bash
git clone <repo-url> picking-up
cd picking-up
```

Then follow **[backend.md](backend.md)** and **[frontend.md](frontend.md)** in order (the backend needs to be running for the frontend's auth flow to work). Both need env files created from the tracked `.env.example` templates — see **[environment-variables.md](environment-variables.md)** for what every variable means.

- **[backend.md](backend.md)** — Python venv, dependencies, database, running the Django API
- **[frontend.md](frontend.md)** — npm install, running the Next.js dev server
- **[environment-variables.md](environment-variables.md)** — every env var, what it does, what to set locally
- **[windows.md](windows.md)** — Windows-specific commands + a real gotcha we hit
- **[macos.md](macos.md)** — macOS-specific commands + the same gotcha's macOS equivalent

## Ports

| Service | Port | Why |
|---|---|---|
| Frontend (`next dev`) | `10050` | set explicitly in `frontend/package.json`'s `dev` script — not Next's default 3000 |
| Backend (`manage.py runserver`) | `8000` | Django's default |

The frontend's `DJANGO_API_BASE_URL` env var and the backend's `DJANGO_CORS_ALLOWED_ORIGINS` env var both need to agree with these ports — see [environment-variables.md](environment-variables.md).

## Verifying it worked

```bash
# backend/ (venv active, local SQLite selected)
python manage.py shell -c "from django.db import connection; print(connection.vendor)"
python manage.py migrate
python manage.py check

# frontend/
npm test
npm exec tsc -- --noEmit
npm run build
```

The database command should print `sqlite`. Then run `python manage.py runserver` in one terminal, `npm run dev` in another, and visit `http://localhost:10050`.

For backend tests that must never inherit a remote `DATABASE_URL`, use the explicit in-memory SQLite commands in [backend.md](backend.md#6-run-isolated-tests).

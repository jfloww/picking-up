# Environment Variables

**Source of truth:** `backend/.env.example` and `frontend/.env.example` (both tracked in git). This page documents what each variable means — it is not a config file itself and does not need to be kept byte-for-byte in sync, but should be updated if a variable's *meaning* changes.

Actual `.env`/`.env.development` files are gitignored (`.gitignore`: `.env`, `.env.*`, with `.env.example` explicitly un-ignored) — they hold real secrets and local values, so they're never committed. Create yours by copying the `.example` file (see [backend.md](backend.md) / [frontend.md](frontend.md)).

## Backend (`backend/.env`)

| Variable | Required? | Local default | Purpose |
|---|---|---|---|
| `DJANGO_SECRET_KEY` | No in dev | insecure placeholder | Django's cryptographic signing key. `config/settings.py` **refuses to start** if `DJANGO_DEBUG=False` and this is still the placeholder — a real value is mandatory in production. Generate one with `python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"`. |
| `DJANGO_DEBUG` | No | `True` | Django debug mode. Must be `False` in production. |
| `DJANGO_ALLOWED_HOSTS` | No | `localhost,127.0.0.1` | Comma-separated list, Django's standard `ALLOWED_HOSTS`. |
| `DJANGO_CORS_ALLOWED_ORIGINS` | No | `http://localhost:10050` | Must exactly match the frontend's origin (scheme + host + port) or browser requests from the frontend will be blocked by CORS. The frontend dev server runs on port **10050**, not Next's default 3000 — see [frontend.md](frontend.md). |
| `DATABASE_URL` | No | unset (→ SQLite) | Database connection URL. Production uses PostgreSQL. Leave it unset locally for `backend/db.sqlite3`; use `sqlite:///:memory:` for an isolated test process. |

Database selection logic lives in `backend/config/settings.py`: `DATABASE_URL` when set → SQLite (`backend/db.sqlite3`) when unset.

`config/settings.py` loads `backend/.env` before `.env.development`, while process environment variables win over both files. An empty process value is not a safe way to neutralize a remote URL because the env loader can fill it again. For isolated tests, explicitly use `DATABASE_URL=sqlite:///:memory:`.

## Frontend (`frontend/.env.development`)

| Variable | Required? | Local default | Purpose |
|---|---|---|---|
| `DJANGO_API_BASE_URL` | No | `http://localhost:8000` | Where the frontend's server-side API calls (`lib/api/server.ts`, `middleware.ts`) send requests. Must point at wherever the Django backend is actually running. In production this must be `https://` — auth cookies are marked `secure` and won't be sent over plain HTTP. |
| `NEXT_PUBLIC_APP_NAME` | No | `Picking Up` | Public app name, bundled into client JS (the `NEXT_PUBLIC_` prefix is Next.js's convention for browser-exposed env vars — don't put secrets here). |

## Local dev checklist

For a fresh machine, the two `.env`/`.env.development` files with just their defaults filled in are enough to run the whole stack:

- SQLite database (no `DATABASE_URL` needed)
- `DJANGO_CORS_ALLOWED_ORIGINS=http://localhost:10050` matching the frontend's actual port
- `DJANGO_API_BASE_URL=http://localhost:8000` matching Django's default port
- `DJANGO_SECRET_KEY` can stay at its insecure placeholder since `DJANGO_DEBUG=True` locally

Before migrations or local server startup, verify the target with:

```bash
python manage.py shell -c "from django.db import connection; print(connection.vendor)"
```

The expected local output is `sqlite`.

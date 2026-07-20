# Backend Setup

Django + Django REST Framework + Simple JWT. Platform-specific venv activation commands are in [windows.md](windows.md) / [macos.md](macos.md) — this page covers everything else.

## 1. Create and activate a virtual environment

See [windows.md](windows.md#backend) or [macos.md](macos.md#backend) for the exact commands, then come back here.

## 2. Install dependencies

```bash
pip install -r requirements.txt
```

From `backend/requirements.txt`:

| Package | Purpose |
|---|---|
| `Django` | web framework |
| `djangorestframework` | REST API layer |
| `djangorestframework-simplejwt` | JWT auth (access + refresh tokens) |
| `django-cors-headers` | CORS for the separately-hosted frontend |
| `django-environ` | loads `.env` files |
| `psycopg[binary]` | PostgreSQL driver (prebuilt wheel, no native Postgres install needed) |
| `oracledb` | Oracle driver, used in **thin mode** — pure Python, no Oracle Instant Client install needed on any platform |

## 3. Create your env file

```bash
cp .env.example .env
```

Then open `.env` and fill in real values — see [environment-variables.md](../setup/environment-variables.md) for what each one does. The defaults are enough to run locally against SQLite with no further changes beyond generating a secret key (optional in debug mode — see below).

## 4. Database

Nothing to install. By checking three env vars in order, `config/settings.py` picks:

1. **Oracle** — if `ORACLE_DB_USER`, `ORACLE_DB_PASSWORD`, and `ORACLE_DB_DSN` are all set.
2. **PostgreSQL** — else if `DATABASE_URL` is set.
3. **SQLite** (`db.sqlite3` in `backend/`) — otherwise. This is the default for local dev and needs zero configuration.

Leave the Oracle/Postgres variables commented out in `.env` to use SQLite.

```bash
python manage.py migrate
```

## 5. Run it

```bash
python manage.py runserver
```

Serves on `http://localhost:8000` by default (Django's default, matches the frontend's `DJANGO_API_BASE_URL`).

## 6. Auth endpoints

```
POST /api/auth/register/
POST /api/auth/token/
POST /api/auth/token/refresh/
GET  /api/auth/me/
```

## 7. Tests

```bash
python manage.py test apps.accounts
```

**Known issue (not platform-specific):** creating the Oracle test database currently fails with `ORA-01031` (insufficient privileges) — unrelated to local setup. Tests fall back to SQLite and pass regardless.

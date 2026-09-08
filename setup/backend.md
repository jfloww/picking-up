# Backend Setup

The backend is Django + Django REST Framework + Simple JWT. PostgreSQL is used when `DATABASE_URL` is configured; otherwise Django uses local SQLite.

Run all commands on this page from `backend/`.

## 1. Create a virtual environment

Use the platform-specific commands in [windows.md](windows.md#backend) or [macos.md](macos.md#backend), then install dependencies:

```bash
pip install -r requirements.txt
```

The requirements include Django, Django REST Framework, JWT authentication, CORS handling, PostgreSQL support, Google authentication helpers, and production serving/static-file packages.

## 2. Create the local environment file

```bash
cp -n .env.example .env
```

PowerShell equivalent:

```powershell
Copy-Item .env.example .env
```

The tracked example is ready for local SQLite. Keep its `DATABASE_URL` line commented out. See [environment-variables.md](environment-variables.md) for every setting.

If `backend/.env` already exists, do not overwrite it blindly. Check whether it points to a remote database first.

## 3. Confirm the database target

Before `migrate`, `runserver`, or tests, verify the selected database backend:

```bash
python manage.py shell -c "from django.db import connection; print(connection.vendor)"
```

For normal local development this must print:

```text
sqlite
```

If it prints `postgresql`, your shell or `.env` defines `DATABASE_URL`. Comment it out for local development, or explicitly set `DATABASE_URL=sqlite:///db.sqlite3` in the current shell. Process environment variables take precedence over `.env`.

## 4. Apply migrations

```bash
python manage.py migrate
```

Run this after every pull that adds a migration. In particular, `0016_focussettings` is required by the planner's multi-focus headliner.

## 5. Start the API

```bash
python manage.py runserver
```

The backend listens on `http://localhost:8000`. Leave this terminal running and start the frontend in a second terminal.

Quick health check:

```text
http://localhost:8000/api/health/
```

## 6. Run isolated tests

An empty `DATABASE_URL` is not a reliable override because `.env` may fill it again. Explicitly select in-memory SQLite.

Windows PowerShell:

```powershell
$env:DATABASE_URL = "sqlite:///:memory:"
.\.venv\Scripts\python.exe manage.py test apps.tasks.test_focus_settings
Remove-Item Env:DATABASE_URL
```

macOS / Linux:

```bash
DATABASE_URL='sqlite:///:memory:' python manage.py test apps.tasks.test_focus_settings
```

Useful test scopes:

```bash
python manage.py test apps.accounts
python manage.py test apps.tasks.test_focus_settings
python manage.py test
```

The complete task suite is much slower than a focused module, so use the narrowest relevant label during development.

## 7. Focus settings API

The multi-focus planner header uses one authenticated resource:

```text
GET /api/focus-settings/  # load focus areas and the active selection
PUT /api/focus-settings/  # save the ordered collection and active selection
```

Focus settings are private to each user. Up to 12 active or archived focus areas are stored.

# Picking Up Backend

Django REST API for authentication, tasks, categories, recurring-task commands, and planner focus areas.

## Quick start

Run these commands from `backend/`.

### Windows PowerShell

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe manage.py shell -c "from django.db import connection; print(connection.vendor)"
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py runserver
```

### macOS / Linux

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp -n .env.example .env
python manage.py shell -c "from django.db import connection; print(connection.vendor)"
python manage.py migrate
python manage.py runserver
```

The API is available at `http://localhost:8000`.

## Database safety

Local development uses `backend/db.sqlite3` when `DATABASE_URL` is absent. Before running migrations, verify that an existing `.env` does not contain a production or shared PostgreSQL URL:

```bash
python manage.py shell -c "from django.db import connection; print(connection.vendor)"
```

The expected local result is `sqlite`. If it prints `postgresql`, comment out `DATABASE_URL` in `backend/.env`, or explicitly override it with `sqlite:///db.sqlite3` for that shell.

Do not use an empty `DATABASE_URL` as a test override: `django-environ` can still load the value from `.env`. Use the explicit in-memory SQLite URL shown below.

## Tests

Run a focused test module against an isolated in-memory database:

```powershell
# Windows PowerShell
$env:DATABASE_URL = "sqlite:///:memory:"
.\.venv\Scripts\python.exe manage.py test apps.tasks.test_focus_settings
Remove-Item Env:DATABASE_URL
```

```bash
# macOS / Linux
DATABASE_URL='sqlite:///:memory:' python manage.py test apps.tasks.test_focus_settings
```

Run the complete backend suite only when needed:

```bash
python manage.py test
```

## After pulling database changes

Always apply migrations before starting the server:

```bash
python manage.py migrate
```

Migration `0016_focussettings` creates the per-user storage used by the planner's multi-focus headliner.

## Main endpoints

```text
GET/POST       /api/tasks/
GET/PUT/DELETE /api/tasks/<id>/
GET/POST       /api/categories/
GET/PUT        /api/focus-settings/
POST           /api/auth/register/
POST           /api/auth/token/
POST           /api/auth/token/refresh/
GET            /api/auth/me/
GET            /api/health/
```

For the full two-service setup, see [`../setup/README.md`](../setup/README.md).

# Windows-Specific Setup

Commands for PowerShell (or Git Bash — adjust as needed). See [backend.md](backend.md) and [frontend.md](frontend.md) for the full step-by-step; this page only covers the commands that differ by platform.

## Backend

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe manage.py shell -c "from django.db import connection; print(connection.vendor)"
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py runserver
```

The database check must print `sqlite` for local development. If an existing `.env` points to PostgreSQL, either comment out `DATABASE_URL` or override it explicitly in the current terminal:

```powershell
$env:DATABASE_URL = "sqlite:///db.sqlite3"
```

For isolated backend tests, use an in-memory database and clean up the process override afterward:

```powershell
$env:DATABASE_URL = "sqlite:///:memory:"
.\.venv\Scripts\python.exe manage.py test apps.tasks.test_focus_settings
Remove-Item Env:DATABASE_URL
```

If `.venv` is already activated in your shell (`.\.venv\Scripts\Activate.ps1`), drop the `.\.venv\Scripts\python.exe` prefix and just use `python`/`pip`/`manage.py` directly.

## Frontend

No platform difference — see [frontend.md](frontend.md) directly.

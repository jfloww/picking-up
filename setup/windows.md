# Windows-Specific Setup

Commands for PowerShell (or Git Bash — adjust as needed). See [backend.md](backend.md) and [frontend.md](frontend.md) for the full step-by-step; this page only covers the commands that differ by platform.

## Backend

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py runserver
```

If `.venv` is already activated in your shell (`.\.venv\Scripts\Activate.ps1`), drop the `.\.venv\Scripts\python.exe` prefix and just use `python`/`pip`/`manage.py` directly.

## Frontend

No platform difference — see [frontend.md](frontend.md) directly.


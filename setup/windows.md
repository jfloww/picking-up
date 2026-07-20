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

## Known gotcha: OneDrive folder sync

If your Windows profile has **OneDrive "Desktop & Documents" backup** enabled and this repo lives under `Desktop\...`, OneDrive actively syncs the project and can transiently lock newly-written files. This showed up in practice as `npm run build` failing with `EPERM: operation not permitted, open '...\.next\trace'` — not a code problem, not caused by a running dev server, just OneDrive mid-sync on a file the build tool is trying to write.

**Avoid it:** clone the repo somewhere OneDrive doesn't back up — e.g. `C:\dev\picking-up` or `C:\Users\<you>\Projects\picking-up` — rather than under `Desktop`. If it must live under a synced folder, expect occasional build/test flakiness and retry after a few seconds.

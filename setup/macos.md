# macOS-Specific Setup

See [backend.md](backend.md) and [frontend.md](frontend.md) for the full step-by-step; this page only covers the commands that differ by platform.

## Toolchain

- **Node 20.x** — install via `nvm` so the version is pinned and easy to switch:
  ```bash
  nvm install 20
  nvm use 20
  ```
- **Python 3.12** — via `pyenv`, or the installer from python.org. Xcode Command Line Tools (`xcode-select --install`) provides the C toolchain Python needs.

## Backend

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp -n .env.example .env
python manage.py shell -c "from django.db import connection; print(connection.vendor)"
python manage.py migrate
python manage.py runserver
```

The database check must print `sqlite` for local development. `psycopg[binary]` ships a prebuilt PostgreSQL wheel, so no native Postgres libraries are needed.

Run a focused backend test without inheriting a remote `.env` URL:

```bash
DATABASE_URL='sqlite:///:memory:' python manage.py test apps.tasks.test_focus_settings
```

## Frontend

No platform difference — see [frontend.md](frontend.md) directly.

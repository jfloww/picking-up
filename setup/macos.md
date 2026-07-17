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
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python manage.py migrate
python manage.py runserver
```

`oracledb` and `psycopg[binary]` both ship prebuilt wheels for macOS (Intel and Apple Silicon) — no Oracle Instant Client, no native Postgres libraries to install. `pip install -r requirements.txt` is genuinely everything.

## Frontend

No platform difference — see [frontend.md](frontend.md) directly.

## Known gotcha: iCloud Drive folder sync

This is the macOS equivalent of a real issue we hit on Windows: if **iCloud Drive's "Desktop & Documents" sync** is enabled and this repo lives under `~/Desktop/...`, iCloud actively syncs the project and can transiently lock newly-written files — the same failure mode as a Windows OneDrive lock (build tools writing to `node_modules/`, `.next/`, or `.venv/` mid-sync). Dropbox or Google Drive set to sync your Desktop would cause the identical problem.

**Avoid it:** clone the repo somewhere not under iCloud/Dropbox/Google Drive sync — e.g. `~/Projects/picking-up` or `~/dev/picking-up` — rather than `~/Desktop/picking-up`.

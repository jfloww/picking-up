# Production Deployment: Backend on OCI VM + Frontend on Vercel

**Date:** 2026-08-05
**Status:** Approved

## Problem

The target architecture has been decided since mid-July
(`docs/planning/2. build-procedure.md`, `4. django-backend.md`,
`6. oracle-database.md`): Next.js on Vercel, Django on an OCI Always Free
VM, Oracle Autonomous Database on OCI. The database leg is done —
provisioned (Autonomous AI Database 26ai, Always Free, `us-ashburn-1`),
migrated, and confirmed reachable walletless over one-way TLS from
Django's `oracledb` thin driver as of 2026-07-15. An OCI Compute VM and
its SSH key already exist (`key/ssh-key-2026-07-14.key`,
`opc@129.213.191.36`). Neither the backend nor the frontend is actually
deployed yet — the VM has SSH access and nothing else confirmed running on
it, and there is no Vercel project.

## Goal

Get a real, working, HTTPS production URL: the Next.js frontend live on
Vercel, talking to a Django backend running as a supervised service on
the existing OCI VM, both configured to use the already-provisioned
Oracle Autonomous DB.

## Scope decisions (brainstormed and approved)

- **Bare-metal on the VM (systemd + venv + gunicorn + nginx), not
  Docker.** No Docker precedent in this repo, the VM is a small Always
  Free shape, and the chosen deploy method (manual SSH, see below) pairs
  naturally with debugging a plain process over SSH rather than a
  container layer.
- **Manual SSH deploy for this pass, not GitHub Actions.** No CI/CD
  exists in this repo today. A repeatable setup script plus a short
  "pull, migrate, restart" runbook gets to a live URL fastest; automating
  it is explicitly deferred, not forgotten.
- **DuckDNS (free subdomain), not a purchased domain — for now.** Backend
  auth cookies are marked `secure`, so production requires real HTTPS,
  which requires a publicly resolvable hostname for Let's Encrypt. A free
  DuckDNS hostname (e.g. `pickingup.duckdns.org`) pointed at
  `129.213.191.36` gets there at zero cost and zero lock-in — swapping in
  a real domain later only touches DNS + one nginx `server_name` + one
  certbot re-run, not the deployment mechanics.
- **Whitenoise for Django static files, not an nginx static-file path.**
  This app's static footprint is just Django admin/DRF-browsable-API
  assets — one middleware line is simpler than keeping an nginx location
  block in sync with `STATIC_ROOT`.
- **Frontend uses Vercel's default `*.vercel.app` domain.** No custom
  domain decision needed for the frontend; independent of the backend's
  DuckDNS hostname.
- **Non-goals for this pass:** GitHub Actions/CI automation, Docker, a
  staging environment, mobile/PWA deployment. All deferred.

## Current state (verified before planning)

- DB: done. `ORACLE_DB_USER`/`ORACLE_DB_PASSWORD`/`ORACLE_DB_DSN` already
  wired in `backend/config/settings.py`; connection is walletless
  (one-way TLS via the thin driver) per `docs/planning/6. oracle-database.md`.
- VM: exists, but **its current state (OS packages installed, whether
  anything is already running) could not be verified from this session**
  — an SSH attempt to `opc@129.213.191.36` timed out from this sandboxed
  environment. This is very likely a network restriction of the sandbox,
  not evidence the VM is down, but it means the first real step of
  execution is confirming SSH access still works before anything else.
- No `Dockerfile`, no CI workflow, no Vercel project, no DuckDNS
  hostname, no gunicorn/whitenoise in `backend/requirements.txt` yet.

## Backend: code changes (testable, part of a normal PR)

- Add `whitenoise` and `gunicorn` to `backend/requirements.txt`.
- `backend/config/settings.py`: insert
  `whitenoise.middleware.WhiteNoiseMiddleware` into `MIDDLEWARE` directly
  after `SecurityMiddleware` (Whitenoise's documented required position),
  add `STATIC_ROOT = BASE_DIR / "staticfiles"`, and set
  `STORAGES["staticfiles"]["BACKEND"] =
  "whitenoise.storage.CompressedManifestStaticFilesStorage"` for
  production-grade static file compression/caching. No behavior change in
  dev (whitenoise no-ops without `collectstatic` having run, and
  `DJANGO_DEBUG=True` locally never hits the production cookie/HTTPS
  requirements).
- `backend/.env.example`: uncomment/fill the existing
  "Production (OCI Always Free VM)" block with the DuckDNS hostname
  placeholder instead of `<oci-vm-public-domain-or-ip>`, matching what
  the runbook below actually sets.

## Backend: VM setup (infrastructure — SSH runbook, not application code)

1. **Verify access.** `ssh -i key/ssh-key-2026-07-14.key opc@129.213.191.36`
   from a network that isn't sandboxed. If the IP no longer responds, the
   instance's public IP may have changed (ephemeral IPs change on
   stop/start) — check the OCI console.
2. **OS packages** (Oracle Linux, `dnf`): `python3.11`, `python3.11-venv`
   (or whatever Python 3.11+ is available), `nginx`, `certbot`,
   `python3-certbot-nginx`, `git`, `firewalld` (usually preinstalled).
3. **Clone the repo** to e.g. `/home/opc/picking-up`, create a venv at
   `backend/.venv`, `pip install -r requirements.txt`.
4. **Production `.env`** at `backend/.env` on the VM (never committed):
   `DJANGO_SECRET_KEY` (freshly generated per the existing
   `.env.example` instructions), `DJANGO_DEBUG=False`,
   `DJANGO_ALLOWED_HOSTS=<duckdns-host>`,
   `DJANGO_CORS_ALLOWED_ORIGINS=https://<vercel-domain>`, plus the
   `ORACLE_DB_USER`/`ORACLE_DB_PASSWORD`/`ORACLE_DB_DSN` values already
   known from the July setup (`key/db-settings.txt` has the DSN;
   credentials come from wherever they were originally recorded — not
   committed to this repo).
5. **DuckDNS.** Register a free hostname at duckdns.org pointed at
   `129.213.191.36`; note the DuckDNS token for the update script (a cron
   job re-pushing the current IP isn't strictly needed on an OCI instance
   with a persistent public IP, but is a cheap safety net against an IP
   change).
6. **gunicorn as a systemd service** (`/etc/systemd/system/gunicorn.service`):
   runs `backend/.venv/bin/gunicorn config.wsgi:application` bound to
   `127.0.0.1:8000`, `WorkingDirectory=.../backend`, `EnvironmentFile=` the
   production `.env` (gunicorn/systemd don't read `.env` via
   `django-environ` the same way `manage.py runserver` does at the shell
   level — needs an explicit `EnvironmentFile=` line or a wrapper), `Restart=always`,
   enabled + started via `systemctl enable --now gunicorn`.
7. **nginx reverse proxy**: a server block proxying `<duckdns-host>` to
   `127.0.0.1:8000` — nginx only proxies here; no static-file location
   block is needed since whitenoise serves static files directly from the
   Django process (that's the whole point of the whitenoise decision
   above). Then `certbot --nginx -d <duckdns-host>` obtains and
   auto-wires the Let's Encrypt cert (certbot edits the nginx config in
   place to add the HTTPS server block + HTTP→HTTPS redirect).
8. **Firewall — both layers:**
   - VM-level: `firewall-cmd --permanent --add-service=https && firewall-cmd --reload`
     (port 80 too, for the certbot HTTP-01 challenge and the redirect).
   - Cloud-level: add an ingress rule for `443/tcp` (and `80/tcp`) from
     `0.0.0.0/0` to the VM's OCI Security List/NSG in the console — this is
     the step that's easy to forget since `curl localhost` on the VM will
     work fine without it, only external access fails.
9. **First-run Django tasks**: `python manage.py migrate` (idempotent —
   already applied per the July doc, but safe/expected to re-run on every
   deploy), `python manage.py collectstatic --noinput`.

## Frontend: Vercel

- Import the GitHub repo into Vercel, set the project root directory to
  `frontend/`.
- Env vars (Vercel project settings): `DJANGO_API_BASE_URL=https://<duckdns-host>`,
  `NEXT_PUBLIC_GOOGLE_CLIENT_ID=<existing Google OAuth client ID>`,
  `NEXT_PUBLIC_APP_NAME=Picking Up`.
- Deploy; Vercel assigns a `*.vercel.app` production URL.

## Cross-configuration (the two sides have to agree with each other)

- Backend `.env`: `DJANGO_CORS_ALLOWED_ORIGINS` must equal the Vercel
  URL exactly (scheme + host).
- Google Cloud Console → OAuth client → "Authorized JavaScript origins":
  add the Vercel production URL (today only local dev origins are
  authorized, per the comment already in `backend/.env.example`).

## Deploy runbook (manual, for this and future updates)

Initial deploy = the numbered VM setup steps above, once.

Every update after that, over SSH:
```
cd ~/picking-up && git pull
backend/.venv/bin/pip install -r backend/requirements.txt
backend/.venv/bin/python backend/manage.py migrate
backend/.venv/bin/python backend/manage.py collectstatic --noinput
sudo systemctl restart gunicorn
```

## Verification / smoke test

- `curl -I https://<duckdns-host>/api/` returns a valid TLS handshake and
  an HTTP response (not a connection error) from a network outside the VM.
- Load the Vercel production URL, register a new account, log in, create
  a task, reload — confirms the full chain (Vercel → Django → Oracle DB)
  round-trips real data.
- `journalctl -u gunicorn -n 50` and `backend/logs/backend.log` on the VM
  are the two places to look if the smoke test fails.

## Non-goals

- No GitHub Actions/CI automation this pass.
- No Docker.
- No staging/second environment.
- No mobile app or PWA deployment.
- No resolution of the two open DB follow-ups from
  `docs/planning/6. oracle-database.md` (dropping the now-unused
  `psycopg` dependency; documenting a DB backup/restore procedure beyond
  Autonomous DB's built-in automatic backups) — real, but independent of
  getting a first deployment live.

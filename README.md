# Picking Up

A personal planner for people who keep rewriting the same to-do list. Tasks live in
a day, a week, a month, or an undated bucket, and move between them as plans change.

**Live:** [pickingup.vercel.app](https://pickingup.vercel.app)

## Features

**Planning**
- Daily, weekly, and monthly views over one shared set of tasks
- Buckets for work that isn't tied to a date yet
- Drag to schedule and reorder; unfinished work carries over rather than disappearing
- Focus areas — pick a current focus and every view narrows to it

**Tasks**
- Subtasks, memos, time of day, duration, due dates, and priority
- Background tasks for things that run alongside the day rather than filling it
- Routines: repeat a task on chosen weekdays. Edit or end the whole series from any
  occurrence, without hunting down the original

**Accounts**
- Email/password or Google sign-in
- Light and dark themes

## Tech

| | |
|---|---|
| **Frontend** | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui on Base UI, Vitest |
| **Backend** | Django 5.1, Django REST Framework, SimpleJWT, gunicorn, Python 3.12 |
| **Database** | PostgreSQL (Neon) |
| **Hosting** | Vercel (frontend), Google Cloud Run (backend) |
| **CI/CD** | GitHub Actions — tests on every PR, automatic deploy on merge to `main` |

The browser never calls Django directly. Next.js route handlers sit in front of the
API as a BFF layer, so tokens stay server-side.

Tasks carry a `version` and every mutation is a command with an expected version, so
two devices editing the same task conflict loudly instead of silently overwriting.

## Layout

```
frontend/   Next.js app — planner UI and the BFF route handlers
backend/    Django REST API
docs/       Architecture, conventions, deployment, design history
setup/      Local development setup, per platform
```

## Getting started

See [`setup/`](setup/) — [macOS](setup/macos.md), [Windows](setup/windows.md), and the
[environment variables](setup/environment-variables.md) each service needs.

## Deploying

Merge to `main`. The pipeline runs the tests, refuses to deploy if the database is
missing migrations, ships the backend as a no-traffic revision it health-checks before
promoting, and deploys the frontend.

- [`docs/deployment/README.md`](docs/deployment/README.md) — how to deploy, and the
  manual break-glass procedure
- [`docs/deployment/pipeline.md`](docs/deployment/pipeline.md) — how the pipeline works,
  why it is built that way, and the traps worth knowing
- [`docs/deployment/gcp-setup.md`](docs/deployment/gcp-setup.md) — the cloud
  infrastructure behind it

Schema changes are applied by hand, on purpose. Local development and production share
one Neon branch, so running `manage.py migrate` locally changes the production schema
immediately — see the deployment guide before writing a migration.

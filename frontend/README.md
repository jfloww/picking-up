# Picking Up Frontend

Next.js web frontend for the Picking Up task app.

## Auth Direction

The frontend uses Django as the backend authority.

- The browser submits login/register requests to Next.js route handlers.
- Next.js calls the Django REST API.
- JWT tokens are stored in HTTP-only cookies.
- Protected frontend routes are guarded by Next middleware.

## Setup

See [`../setup/`](../setup/) for full local development setup (env vars, running the dev server, tests) — this frontend expects the Django backend described there to be running on `http://localhost:8000`.

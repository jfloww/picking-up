# Picking Up Frontend

Next.js web frontend for the Picking Up task app.

## Auth Direction

The frontend uses Django as the backend authority.

- The browser submits login/register requests to Next.js route handlers.
- Next.js calls the Django REST API.
- JWT tokens are stored in HTTP-only cookies.
- Protected frontend routes are guarded by Next middleware.

## Required Environment

Copy `.env.example` to `.env.local` and set:

```text
DJANGO_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_APP_NAME=Picking Up
```

## Expected Django Auth Endpoints

```text
POST /api/auth/register/
POST /api/auth/token/
POST /api/auth/token/refresh/
GET  /api/auth/me/
```

## Development

```text
npm install
npm run dev
```

# Development History: Project Foundation

## Date

2026-07-13

## Goal

Start a real-life to-do platform with a web-first product direction, shared backend, and future iPhone support.

## Product Direction Decisions

- Build the desktop browser version first.
- Keep the web app responsive so it works in small browser windows and mobile browsers.
- Build a native iPhone app later only if the PWA/mobile web version is not enough.
- Use one shared backend for web and future iPhone clients.
- Start with a focused to-do workflow before adding advanced features.

## Repository Shape

Planned workspace structure:

```text
frontend/         -> Next.js desktop web app
backend/          -> Django REST API
mobile-frontend/  -> future iPhone app
docs/             -> planning and development history
```

## Backend Direction

The backend direction was changed from Supabase to Django.

Current backend standard:

```text
Django
Django REST Framework
Simple JWT
Oracle Database on OCI for production
SQLite only as a temporary local development fallback
```

The backend owns:

- Authentication.
- Authorization.
- API contracts.
- Task data.
- Database migrations.

## Deployment Direction

Current deployment target:

```text
frontend/ -> Vercel
backend/  -> Oracle Cloud Infrastructure Always Free VM
database  -> Oracle Database on OCI
```

Earlier options discussed included Vercel + Supabase, Neon Postgres, Render, Railway, and Fly.io. The current documented direction is OCI for backend and Oracle Database.

## Planning Docs Created

Created numbered planning docs under `docs/planning`:

```text
0. index.md
1 first-plan.md
2. build-procedure.md
3. design-patterns.md
4. django-backend.md
5. auth-todo.md
6. oracle-database.md
```

These docs capture:

- Product plan.
- Build order.
- Frontend/backend design patterns.
- Django backend plan.
- V1 authentication checklist.
- Deferred authentication work.
- Oracle Database plan.

## Frontend Work Completed

Created a Next.js frontend scaffold under `frontend`.

Key files:

```text
frontend/package.json
frontend/next.config.ts
frontend/tsconfig.json
frontend/src/app/layout.tsx
frontend/src/app/globals.css
frontend/src/app/page.tsx
frontend/src/app/login/page.tsx
frontend/src/app/signup/page.tsx
frontend/src/app/app/page.tsx
frontend/src/middleware.ts
frontend/src/lib/auth/cookies.ts
frontend/src/lib/api/server.ts
frontend/src/features/auth/
frontend/src/app/api/auth/
```

Implemented frontend auth foundation:

- Login page.
- Signup page.
- Protected `/app` route.
- Logout button.
- Next.js middleware route protection.
- Next.js route handlers for auth.
- HTTP-only cookie storage for JWT access and refresh tokens.
- API wrapper for calling Django from Next.js server code.

Current frontend auth flow:

```text
Browser login form
  -> Next.js /api/auth/login
  -> Django /api/auth/token/
  -> Next.js stores JWT in HTTP-only cookies
  -> /app is protected by middleware
```

## Frontend Theme Work Completed

Added automatic light/dark theme support in:

```text
frontend/src/app/globals.css
```

Behavior:

- Light theme is used when the browser/system prefers light.
- Dark theme is used when the browser/system prefers dark.
- Theme colors are defined through CSS variables.
- Inputs, borders, focus rings, shadows, and error states work in both themes.

## Backend Work Completed

Created Django backend scaffold under `backend`.

Key files:

```text
backend/requirements.txt
backend/.env.example
backend/manage.py
backend/config/settings.py
backend/config/urls.py
backend/apps/accounts/
backend/README.md
```

Implemented V1 authentication backend:

- Registration endpoint.
- Email/password JWT login endpoint.
- JWT refresh endpoint.
- Current user endpoint.
- CORS setup for local Next.js frontend.
- Basic auth tests.

Current backend auth endpoints:

```text
POST /api/auth/register/
POST /api/auth/token/
POST /api/auth/token/refresh/
GET  /api/auth/me/
```

## Local Database State

SQLite is currently used only as a temporary local development fallback.

Reason:

- Fast local setup.
- No local database server required.
- Allows auth/API foundation to be built quickly.

Production direction:

```text
Oracle Database on OCI
```

## Verification Performed

Frontend:

```text
npm install
npm run build
```

Result:

```text
Next.js production build passed.
```

Backend:

```text
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py test apps.accounts
```

Result:

```text
System check identified no issues.
Migrations completed.
Ran 2 tests successfully.
```

## Operational Notes

- A root `.gitignore` was added for `node_modules`, `.next`, `.venv`, Python caches, local SQLite, and environment files.
- The workspace was not a Git repository when checked with `git status`.
- The Windows sandbox shell repeatedly failed to spawn PowerShell with error `CreateProcessAsUserW failed: 1312`; escalated shell runs were used for directory checks and verification commands.
- Next.js `.next/trace` became locked by running Node/Next processes once. Project-local Next processes were stopped, `.next` was cleared, and the clean build passed.

## Deferred Auth Items

Deferred items were saved in:

```text
docs/planning/5. auth-todo.md
```

Deferred for later:

- Forgot password.
- Email verification.
- Google/OAuth login.
- Passkeys.
- Multi-factor authentication.
- User profile settings.
- Account deletion.
- Advanced session management.
- Refresh-token cookie rotation from frontend route handler.
- Token blacklist on logout.
- Production security hardening checklist.

## Current Next Best Steps

Recommended next implementation order:

```text
1. Connect frontend login/signup against the running Django backend.
2. Add refresh-token handling in the Next.js auth route layer.
3. Add task app to Django.
4. Add task API permissions and tests.
5. Build the desktop task UI in `/app`.
6. Add Oracle Database settings and test migrations against OCI.
```

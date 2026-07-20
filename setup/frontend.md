# Frontend Setup

Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 4. The backend ([backend.md](backend.md)) should be running first — the auth flow (login/signup, `/app`) proxies to it.

## 1. Install dependencies

```bash
cd frontend
npm install
```

Nothing platform-specific here — same command on Windows and macOS.

## 2. Create your env file

```bash
cp .env.example .env.development
```

Then fill in real values — see [environment-variables.md](environment-variables.md). The default `DJANGO_API_BASE_URL=http://localhost:8000` matches the backend's default port, so nothing needs to change for a standard local setup.

## 3. Run the dev server

```bash
npm run dev
```

Serves on **`http://localhost:10050`** — not Next's default 3000; the port is set explicitly in `package.json`'s `dev` script (`next dev -p 10050`). The backend's `DJANGO_CORS_ALLOWED_ORIGINS` must include this exact origin (`http://localhost:10050`) — see [environment-variables.md](environment-variables.md).

## 4. Tests, lint, build

```bash
npm test        # Vitest + Testing Library, jsdom
npm run lint     # ESLint (Next's flat config)
npm run build    # production build, 9 routes expected
```

## Routes

| Route | Purpose |
|---|---|
| `/` | Landing page — public, shows "Sign in" or your name depending on auth state |
| `/login`, `/signup` | Auth forms |
| `/app` | Protected task workspace — redirects to `/login` if not authenticated |
| `/api/auth/*` | Route handlers proxying to the Django backend |

# Development History: Vercel Wired to Cloud Run

## Date

2026-08-09

## Goal

Point the frontend at the new Cloud Run backend, completing the migration
away from OCI/Oracle: `Vercel → Cloud Run → Neon`, full stack live. Follows
directly from `005-cloud-run-live-deploy.md`.

## Result

**Frontend live:** `https://frontend-liard-seven-91.vercel.app`
**Backend live:** `https://picking-up-api-723438086234.us-east4.run.app`

No Vercel project existed yet for this app (confirmed before starting —
no `frontend/.vercel/` directory, no CLI installed), so this was a
from-scratch setup, not just an env var change.

## Work Completed

```text
npm install -g vercel
vercel login                # device-code browser auth; account "jfloww"
cd frontend && vercel link --yes   # created jflowws-projects/frontend
```

Production env vars set via `vercel env add <NAME> production`:
- `DJANGO_API_BASE_URL` → the Cloud Run service URL
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` → existing OAuth client ID (same as backend)
- `NEXT_PUBLIC_APP_NAME` → `Picking Up`

Deployed: `vercel --prod`.

Backend: updated `DJANGO_CORS_ALLOWED_ORIGINS` on the Cloud Run service to
the real Vercel origin (defense-in-depth only, matching the OCI runbook's
own reasoning — the browser never calls Django directly, Next.js's
server-side BFF does).

## Verification Performed

```text
curl https://frontend-liard-seven-91.vercel.app/login
-> 200

curl -X POST https://frontend-liard-seven-91.vercel.app/api/auth/register
-> 201, {"user":{"id":3,...}}
```
This exercised the full real chain — Vercel's Next.js server → its own
`/api/auth/register` route handler → Cloud Run → Neon — not just each
piece booting in isolation. Test account (`id=3`,
`vercel-smoketest@example.com`) deleted afterward via `manage.py shell`,
same cleanup pattern as `005`'s Cloud Run-only smoke test. Confirmed only
the real account (`id=1`, `hoon7589@gmail.com`) remains.

Re-verified `/api/health/` still `200` after the CORS-origin update.

## Known Follow-up, Not Done (needs manual Console action)

Google Sign-In will fail on the new Vercel domain until
`https://frontend-liard-seven-91.vercel.app` is added to the OAuth
client's **Authorized JavaScript origins** in Google Cloud Console — not
something manageable via `gcloud` CLI for this client type. Email/password
auth already works fine on the new domain; only the Google button is
affected.

## Current State

```text
Frontend  -> Vercel (jflowws-projects/frontend), live
Backend   -> Google Cloud Run (picking-up-api), live
Database  -> Neon PostgreSQL (pooled connection)
OCI VM    -> still running the old stack, not yet decommissioned
```

## Deferred / Next Steps

```text
1. Add the Vercel domain to the OAuth client's Authorized JavaScript
   origins (Google Cloud Console — manual)
2. GitHub Actions / OIDC / Workload Identity Federation for CI/CD (both
   Cloud Run and Vercel sides)
3. Custom domain for either service (currently *.run.app / *.vercel.app)
4. Shared cache for cross-instance Cloud Run throttle correctness, if
   traffic ever justifies max-instances > 1 in practice
5. Decommission the OCI VM once this stack is confirmed stable over time
```

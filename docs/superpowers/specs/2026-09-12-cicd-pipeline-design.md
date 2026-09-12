# CI/CD Pipeline Design

**Goal:** Deploy the backend to Cloud Run and the frontend to Vercel automatically on
merge to `main`, while keeping schema migrations a deliberate manual act — and refusing
to deploy when they have not been run.

**Status:** Approved design, not yet implemented.

**Context:** `docs/deployment/README.md` documents the current all-manual procedure, and
`docs/db-migration/cloud-run-deployment.md` deferred CI/CD until that manual flow was
understood end to end. It now is. This spec closes that deferral.

---

## Scope

**In scope**

- Automatic backend build + deploy on merge to `main`.
- Automatic frontend build + deploy on merge to `main`.
- A hard gate that fails the release when the new code has unapplied migrations.
- A candidate-revision health check, so a broken image never serves live traffic.
- Keyless GitHub → Google Cloud authentication (Workload Identity Federation).

**Out of scope — deliberately still manual**

- Running `manage.py migrate`. The pipeline detects unapplied migrations; it never
  applies them.
- Environment variable and secret changes (`docs/deployment/README.md` §1, §2).
- Rollback. Cloud Run revisions are immutable and retained; rollback stays
  `gcloud run services update-traffic`.
- PR preview deploys on Vercel.
- Custom domains, OCI VM decommission.

---

## Current state

| Piece | Where | Identifier |
|---|---|---|
| Frontend | Vercel | project `pickingup`, org `team_1Br2PFa6QEsQoy8nGOgkEaFY` |
| Backend | Cloud Run, project `jfloww-picking-up`, region `us-east4` | service `picking-up-api` |
| Image | Artifact Registry | `us-east4-docker.pkg.dev/jfloww-picking-up/picking-up/backend` |
| Database | Neon | branch `production` |
| CI | GitHub Actions | `.github/workflows/ci.yml` — tests on PR and push to `main` |

`ci.yml` already runs the right checks (backend `check`, migration drift, tests;
frontend test, lint, build). Only the deploy half is missing.

Note: `docs/deployment/README.md` names the Vercel project as
`jflowws-projects/frontend`. That is stale — the live link in `frontend/.vercel/` points
at project `pickingup`, and the documented frontend URL 307-redirects to
`https://pickingup.vercel.app/`. The doc is corrected as part of this work.

---

## Architecture

```
push to main
    │
    ├─ changes        (dorny/paths-filter: backend/** ? frontend/** ?)
    │
    ├─ tests          (reusable workflow — the existing CI jobs)
    │
    ├─ backend        (needs: tests; if backend changed)
    │     ├─ auth to GCP via Workload Identity Federation
    │     ├─ gcloud builds submit --tag …/backend:<sha>
    │     ├─ MIGRATION GATE: Cloud Run Job, new image, `migrate --check`
    │     ├─ gcloud run deploy --no-traffic --tag candidate
    │     ├─ health check the candidate URL (status + commit SHA)
    │     └─ gcloud run services update-traffic --to-tags candidate=100
    │
    └─ frontend       (needs: tests, backend; if frontend changed)
          ├─ vercel pull / vercel build
          └─ vercel deploy --prebuilt --prod
```

### Workflow files

Three files, replacing one:

| File | Trigger | Contents |
|---|---|---|
| `.github/workflows/tests.yml` | `workflow_call` | The `backend` and `frontend` jobs, moved verbatim from today's `ci.yml` |
| `.github/workflows/ci.yml` | `pull_request` | Calls `tests.yml`. Nothing else |
| `.github/workflows/deploy.yml` | `push` to `main`, `workflow_dispatch` | Calls `tests.yml`, then deploys |

Extracting the test jobs into a reusable workflow makes "the deployed commit passed the
tests" structurally true rather than a convention, without duplicating the job
definitions or paying for a second test run on PRs.

`deploy.yml` carries `concurrency: group: deploy-production, cancel-in-progress: false`
so two releases never overlap — a cancelled deploy mid-`update-traffic` is worse than a
queued one.

### Ordering

When a release touches both halves, the backend promotes before the frontend job starts
(`needs: [tests, backend]`). The API is therefore never behind the UI calling it. When
only the frontend changed, the `backend` job is skipped and the frontend job still runs —
`if: always() && needs.backend.result != 'failure'`.

The filter is an inclusion list, not an exclusion one: a commit deploys the backend only
if it touched `backend/**` and the frontend only if it touched `frontend/**`. Everything
else — `docs/**`, `english-log/**`, `setup/**`, `README.md` — deploys nothing by default.

`ci.yml` drops its current `push: branches: [main]` trigger, since `deploy.yml` now runs
the same tests on `main`. Without that change every merge would run the suite twice.

---

## The migration gate

The crux of this design. The pipeline must know whether the database has every migration
the new code expects, without a production database credential ever entering GitHub.

**Mechanism:** after the image is built and before anything is deployed, the workflow
runs a one-off Cloud Run Job built from *that exact image*:

```
gcloud run jobs deploy picking-up-api-migrate \
  --image us-east4-docker.pkg.dev/jfloww-picking-up/picking-up/backend:<sha> \
  --region us-east4 \
  --command python \
  --args manage.py,migrate,--check \
  --set-secrets DATABASE_URL=picking-up-database-url:latest,DJANGO_SECRET_KEY=picking-up-django-secret-key:latest \
  --set-env-vars DJANGO_DEBUG=False,DJANGO_NUM_PROXIES=1,DJANGO_ALLOWED_HOSTS=localhost,DJANGO_ENVIRONMENT=production \
  --execute-now --wait
```

`migrate --check` exits non-zero when migrations are unapplied, which fails the job,
which fails the workflow. Nothing is deployed.

**Why a Cloud Run Job rather than a step in the workflow:** the job reads `DATABASE_URL`
from Secret Manager inside GCP. GitHub Actions is granted permission to *launch* the job,
never to read the credential. It also runs the check with the real image, real Python
version, and real dependency set, rather than a CI approximation of them.

**Consequence for secrets:** `DATABASE_URL` and `DJANGO_SECRET_KEY` move from plain Cloud
Run env vars into Secret Manager, so the service and the job reference one copy instead of
two. This is a prerequisite, not a side effect.

**Failure message.** The job's failure is terse, so the workflow catches a non-zero exit
and prints the actionable instruction:

```
Unapplied migrations detected. Run them before deploying:
    cd backend && python manage.py migrate
See docs/deployment/README.md §3.
```

---

## Candidate revision and promotion

The deploy is split into two Cloud Run operations:

```
gcloud run deploy picking-up-api \
  --image …/backend:<sha> --region us-east4 \
  --no-traffic --tag candidate \
  --update-env-vars DJANGO_GIT_SHA=<short-sha>,DJANGO_ENVIRONMENT=production
```

The new revision exists and is reachable at its tagged URL, but serves no live traffic.
The workflow then health-checks it:

```
curl -fsS https://candidate---picking-up-api-723438086234.us-east4.run.app/api/health/
```

and asserts both `"status": "ok"` and that `commit` equals the short SHA being deployed —
the second assertion is what proves the promoted revision is the one just built, rather
than a stale revision answering. Only then:

```
gcloud run services update-traffic picking-up-api --region us-east4 --to-tags candidate=100
```

**`DJANGO_ALLOWED_HOSTS` must be extended.** `backend/config/settings.py:34` reads
`ALLOWED_HOSTS` as a strict list. The tagged candidate URL is a different hostname from
the service URL, so without adding it Django answers the health check with
`400 Bad Request` and every deploy fails. Both hostnames are added, to
`DJANGO_ALLOWED_HOSTS` and to `DJANGO_CSRF_TRUSTED_ORIGINS`.

**Image tags.** Images are tagged with the full commit SHA instead of `:latest`. Two
reasons: `:latest` makes "which image is this revision running" unanswerable after the
next build, and the migration gate must run the same immutable artifact the deploy will
promote. A moving tag cannot guarantee that.

---

## Frontend deploy

```
vercel pull --yes --environment=production --token=$VERCEL_TOKEN
vercel build --prod --token=$VERCEL_TOKEN
vercel deploy --prebuilt --prod --token=$VERCEL_TOKEN
```

Building in CI and uploading a prebuilt artifact means the deployed bundle is the one the
pipeline validated, rather than a second, independently produced build.

`VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` come from repository variables (the values in
`frontend/.vercel/project.json`); `VERCEL_TOKEN` is a repository secret.

Vercel Git integration stays off. Production deploys have exactly one path.

---

## One-time setup (manual, outside the repo)

This is the bulk of the work and none of it is code.

**Google Cloud**

1. Workload Identity Pool + OIDC provider for GitHub, with the attribute condition
   restricting it to `assertion.repository == 'jfloww/picking-up'`.
2. Deployer service account, bound to that provider, with:
   `roles/run.admin`, `roles/cloudbuild.builds.editor`, `roles/artifactregistry.writer`,
   `roles/iam.serviceAccountUser` (to act as the runtime SA), `roles/storage.objectAdmin`
   (Cloud Build's staging bucket), `roles/logging.viewer`.
3. Secret Manager: create `picking-up-database-url` and `picking-up-django-secret-key`
   from the current Cloud Run env var values; grant the *runtime* service account
   `roles/secretmanager.secretAccessor`; switch the service over to `--set-secrets`.
4. Extend `DJANGO_ALLOWED_HOSTS` and `DJANGO_CSRF_TRUSTED_ORIGINS` with the candidate
   hostname.

**GitHub**

5. Repository secret: `VERCEL_TOKEN`.
6. Repository variables: `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER`,
   `GCP_DEPLOYER_SA`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

No service-account JSON key is created at any point.

---

## Error handling

Every failure mode leaves production untouched:

| Failure | Result |
|---|---|
| Tests fail | Nothing builds |
| Image build fails | Nothing deploys |
| Unapplied migrations | Release stops with the actionable message above |
| Candidate unhealthy / wrong SHA | Traffic never moves; previous revision keeps serving |
| Vercel deploy fails | Backend already promoted; frontend unchanged. Re-run the job |
| Two pushes in quick succession | Second release queues behind the first |

Residue left by a failed run: an unpromoted Cloud Run revision and a pushed image,
both inert.

The one genuinely asymmetric case is backend-promoted-then-frontend-failed. This is
acceptable because the backend is additive-first by convention (the focus-areas release
is a new table and new endpoints), so a frontend one release behind still works.

---

## Verification

Workflows cannot be unit-tested, so the plan verifies behavior directly:

1. **`dry_run` input** on `workflow_dispatch` that runs everything up to and including
   the candidate health check, then stops before `update-traffic`. First execution of the
   pipeline uses it.
2. **Gate proof:** no throwaway migration is needed — `0016_focussettings` is already
   unapplied in production, so the gate is first exercised against a genuine failing
   state, then re-run after `manage.py migrate` to confirm it passes. Observing both
   states is the only way to know the gate discriminates rather than always succeeding.
3. **Health-check proof:** confirm the candidate hostname answers `200` rather than `400`
   after the `ALLOWED_HOSTS` change — the single most likely thing to be wrong.
4. **Path filter proof:** a docs-only commit to `main` deploys nothing.
5. **First real release:** the pending focus-areas release, deployed by the pipeline with
   migrations applied by hand first.

---

## Documentation

`docs/deployment/README.md` is updated in the same change:

- §1 corrected to name the Vercel project `pickingup` and the current URL.
- New section describing the automatic path, with the manual commands retained — they
  remain the break-glass procedure when the pipeline is unavailable.
- "Not yet set up" list amended: auto-deploy and WIF move out of it; manual migrations,
  previews, and custom domains stay.

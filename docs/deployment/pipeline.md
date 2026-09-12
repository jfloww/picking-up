# How the CI/CD pipeline works

Why the deploy pipeline is shaped the way it is, what each tool does, and the
traps that are easy to fall into.

For the operational procedure ("I want to deploy, what do I type"), see
[`README.md`](README.md). For the inventory of cloud resources behind it, see
[`gcp-setup.md`](gcp-setup.md). This document is the reasoning.

---

## The shape of it

```
merge to main  (or `gh workflow run deploy.yml`)
    │
    ├─ changes ──── which halves actually changed?
    │
    ├─ tests ────── the same jobs a PR runs
    │
    ├─ backend ──── build → GATE → candidate → health check → promote
    │
    └─ frontend ─── pull → build → deploy
```

Three workflow files, and the split matters:

| File | Trigger | Job |
|---|---|---|
| `tests.yml` | `workflow_call` | Holds the actual test jobs. Called by the other two |
| `ci.yml` | `pull_request` | Calls `tests.yml`. Nothing else |
| `deploy.yml` | `push` to `main`, `workflow_dispatch` | Calls `tests.yml`, then deploys |

`tests.yml` exists so that "the deployed commit passed the tests" is
*structural* rather than a convention someone has to remember. Both the PR gate
and the release path run the same job definitions, because there is only one
copy of them. `ci.yml` deliberately has no `push` trigger — `deploy.yml` covers
`main`, and leaving it would run the whole suite twice per merge.

---

## The tool chain

| Tool | Role | Why this one |
|---|---|---|
| **GitHub Actions** | Orchestration | The repo already lives here; reusable workflows give the one-definition property above |
| **Workload Identity Federation** | GitHub → GCP auth | No service-account JSON key exists anywhere. GitHub mints a short-lived OIDC token, GCP exchanges it. A leaked repo secret cannot become permanent cloud access |
| **Cloud Build** | Builds the image | This project is developed on Apple Silicon (`arm64`); Cloud Run needs `linux/amd64`. Building in the cloud sidesteps cross-compilation entirely |
| **Artifact Registry** | Stores the image | Tagged by full commit SHA, never `:latest` — see below |
| **Cloud Run Jobs** | Runs the migration gate | Lets the gate read `DATABASE_URL` from Secret Manager *inside* GCP. GitHub is granted permission to launch the job, never to read the credential |
| **Secret Manager** | Holds DB URL + Django key | One copy, referenced by both the service and the gate job |
| **Cloud Run** | Serves the backend | Immutable revisions make rollback a traffic change, not a rebuild |
| **Vercel CLI** | Deploys the frontend | Building in CI and uploading a prebuilt artifact means the deployed bundle is the one the pipeline validated, not a second independent build |
| **Neon** | PostgreSQL | Pooled connection for Cloud Run, direct for local dev |

---

## The release sequence, and why each step exists

### 1. Change detection

`dorny/paths-filter` decides whether `backend/**` or `frontend/**` was touched.
Docs-only commits deploy nothing.

A **manual dispatch overrides this and runs both halves**. On `workflow_dispatch`
there is no push payload, so the filter compares against the default branch and
would report "nothing changed" — which would make a dry run silently prove
nothing. An explicit dispatch is explicit human intent, so it runs everything.

### 2. Tests

The same backend and frontend jobs a PR runs. Nothing is built if they fail.

### 3. Build

The image is tagged with the **full commit SHA**, not `:latest`. Two reasons:
`:latest` makes "which image is this revision running?" unanswerable after the
next build, and the migration gate must run the same immutable artifact the
deploy will promote. A moving tag cannot guarantee that.

### 4. The migration gate

A one-off Cloud Run Job runs `manage.py migrate --check` using the image just
built. Non-zero exit fails the release before anything is deployed.

It runs as a Cloud Run Job rather than a workflow step so the database
credential never leaves GCP, and so the check runs with the real image, real
Python version, and real dependency set rather than a CI approximation.

### 5. Candidate revision

The new revision is deployed with `--no-traffic --tag candidate`. It exists and
is reachable at its own hostname, but serves nobody.

### 6. Health check

The candidate is checked on its tagged URL. Two assertions, both necessary:
`"status": "ok"`, and that the reported `commit` equals the SHA being deployed.
The second is what proves the *new* revision answered rather than a stale one.

The check retries, and the commit assertion is **inside** the retry loop. Cloud
Run routing can lag, so a first response may legitimately carry the previous
revision's commit. Treating that as final would spuriously fail good releases.

### 7. Promotion

Only now does traffic move, and only when `github.ref == 'refs/heads/main'`.

That ref guard is a safety boundary, not a formality. Without it,
`gh workflow run deploy.yml --ref some-branch` would build that branch and give
it 100% of production traffic. The frontend deploy carries the same guard —
otherwise a branch dispatch could ship a frontend while the backend correctly
refused to promote, which is a split release and worse than either half alone.

**Every failure leaves production untouched.** Tests red, nothing builds.
Migrations unapplied, nothing deploys. Candidate unhealthy, traffic never moves
and the old revision keeps serving. The only residue from a failed run is an
unpromoted revision and a pushed image, both inert.

---

## Migrations are deliberately manual

The container's `CMD` does not run `migrate`, and neither does the pipeline.
Concurrent container starts would race the same migration against Neon.

The pipeline only ever runs `migrate --check`. Applying migrations is a separate,
deliberate human act:

```bash
cd backend && python manage.py migrate
```

Run it **before** merging code that depends on the new schema. If you forget,
the gate stops the release — that is the gate working, not a bug.

### The trap: local dev and production share one Neon branch

`backend/.env.development` and Cloud Run point at the **same** Neon branch.
There is no separate local database.

So **running `migrate` locally releases the schema change to production
immediately** — weeks before the code that uses it, if you are developing a
feature over time. This is not hypothetical: when this pipeline was built, the
`0016_focussettings` migration was already live in production because the
feature had been developed locally, and the gate correctly reported nothing to
apply.

For anything beyond an additive migration — renames, drops, non-nullable columns
without a default — use expand/contract, because old and new code will overlap
against that schema for real.

---

## Gotchas that cost real time

Each of these was found the hard way. They are written down so they are found
cheaply next time.

### Cloud Run has two hostname formats and they are not interchangeable

The service answers on both `picking-up-api-723438086234.us-east4.run.app` and
`picking-up-api-63ks3zx4gq-uk.a.run.app`. `gcloud run services describe
--format='value(status.url)'` returns the **hash** form, which is what the health
check derives the candidate URL from.

`ALLOWED_HOSTS` is a strict list (`backend/config/settings.py`). Listing only one
format means the health check gets `400` and **every deploy fails**. All four
hosts — both formats, service and candidate — must be listed.

### `gcloud builds submit` exits 1 after a build that succeeded

The default Cloud Build logs bucket is readable only with project Viewer/Owner.
The deployer service account deliberately does not have that, so gcloud fails
while *streaming logs* even though the build succeeded and pushed the image.

`--suppress-logs` does **not** fix this; gcloud performs the access check anyway.
The fix is `--gcs-log-dir` pointing at the project's own `_cloudbuild` bucket,
which the deployer can already read. This is invisible when you run the command
locally as an Owner.

### Vercel tokens must be team-scoped, not project-scoped

A token scoped to the `pickingup` *project* fails with `Could not retrieve
Project Settings`. `vercel pull` resolves project settings through team-level API
calls that a project-scoped token cannot make. Create the token with the **team**
(`jfloww's projects`) as its scope.

### `workflow_dispatch` needs the workflow on the default branch

A workflow is not dispatchable until its file exists on `main`, no matter what
`--ref` you pass. Building a deploy workflow on a feature branch means you cannot
test it until it is merged — so land a minimal, safe version first.

---

## Deliberately not automated

- **Applying migrations.** See above.
- **Environment variables and secrets.** Changed by hand, per `README.md`.
- **Rollback.** Revisions are immutable and retained, so rollback is a traffic
  change:
  ```bash
  gcloud run services update-traffic picking-up-api --region us-east4 \
    --to-revisions=<previous-revision>=100
  ```
- **PR preview deploys.** Vercel Git integration stays off so production has
  exactly one path.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Release stops at "Migration gate" | Unapplied migrations. Run `cd backend && python manage.py migrate`, then re-dispatch |
| Health check fails with `400` | A hostname is missing from `DJANGO_ALLOWED_HOSTS`. Check both formats |
| Health check fails on commit mismatch | The candidate served a stale revision through all retries. Re-dispatch; if it persists, check the revision actually deployed |
| Build step fails but the image exists | Log-bucket permissions — see the `--gcs-log-dir` gotcha |
| `Could not retrieve Project Settings` | Vercel token is project-scoped; reissue with team scope |
| Backend deployed, frontend job failed | `VERCEL_TOKEN` missing or expired. The backend is already promoted; fix the token and re-dispatch |
| Nothing deployed after a merge | The path filter saw no `backend/**` or `frontend/**` changes. Use `gh workflow run deploy.yml` to force both halves |

Useful commands:

```bash
gh run watch                                   # follow the current release
gh workflow run deploy.yml -f dry_run=true     # everything except moving traffic
curl -s https://picking-up-api-723438086234.us-east4.run.app/api/health/
```

A dry run is cheap and proves the whole path — build, gate, candidate, health
check — without releasing anything. Use it whenever you change the pipeline
itself.

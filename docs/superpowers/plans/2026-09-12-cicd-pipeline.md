# CI/CD Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the backend to Cloud Run and the frontend to Vercel automatically on merge to `main`, refusing to deploy when the new code has unapplied migrations.

**Architecture:** The existing CI jobs move into a reusable workflow that both `ci.yml` (pull requests) and a new `deploy.yml` (pushes to `main`) call, so "the deployed commit passed the tests" is structural. `deploy.yml` authenticates to Google Cloud with Workload Identity Federation, builds a SHA-tagged image, runs `migrate --check` as a one-off Cloud Run Job against that exact image, deploys the result as a no-traffic `candidate` revision, health-checks it, and only then shifts traffic. The frontend deploys from the same workflow via the Vercel CLI.

**Tech Stack:** GitHub Actions (reusable workflows, `dorny/paths-filter`, `google-github-actions/auth`), Google Cloud (Cloud Build, Artifact Registry, Cloud Run services + jobs, Secret Manager, Workload Identity Federation), Vercel CLI, Django 5 + gunicorn, Next.js 15.

**Spec:** `docs/superpowers/specs/2026-09-12-cicd-pipeline-design.md`

## Global Constraints

- Branches: Tasks 1-2 land on `feat/cicd-pipeline` (already checked out; the spec is committed there) and **merge to `main` early**. Tasks 3-8 continue on a second branch, `feat/cicd-deploy-jobs`.
- **Why two PRs:** `workflow_dispatch` only becomes dispatchable once the workflow file exists on the default branch. Until `deploy.yml` is on `main`, `gh workflow run deploy.yml --ref <branch>` fails with *"Workflow does not have 'workflow_dispatch' trigger"*. The first PR therefore lands a deploy workflow that can only be triggered by hand and does nothing but authenticate; it is safe to merge. Every later `--ref feat/cicd-deploy-jobs` dispatch then runs that branch's version of the file.
- **Never write a secret value into the repo, a plan file, a commit message, or a workflow file.** `DATABASE_URL` and `DJANGO_SECRET_KEY` are currently plaintext env vars on the Cloud Run service; Task 3 moves them by piping values machine-to-machine, never by typing or echoing them.
- GCP project `jfloww-picking-up`, project number `723438086234`, region `us-east4`.
- Cloud Run service `picking-up-api`; runtime service account `723438086234-compute@developer.gserviceaccount.com` (the project default — unchanged by this work).
- Image repository `us-east4-docker.pkg.dev/jfloww-picking-up/picking-up/backend`.
- Image tag = the **full** commit SHA (`${{ github.sha }}`). `DJANGO_GIT_SHA` = the **short 7-character** SHA, matching the existing convention (`/api/health` currently reports `2810b39`).
- Cloud Run tag for the unpromoted revision is `candidate`; its hostname is the service hostname prefixed with `candidate---`.
- No service-account JSON key is created at any point. GitHub authenticates via WIF only.
- The pipeline never runs `manage.py migrate`. It only ever runs `migrate --check`.
- Pin every GitHub Action to a major version tag (`@v7`, `@v3`, `@v2`) consistent with the existing `ci.yml`.
- GitHub repo is `jfloww/picking-up`; `gh` CLI is installed and authenticated.

---

### Task 1: Extract the reusable tests workflow

Splits today's `ci.yml` into a reusable definition plus a thin PR caller, so `deploy.yml` can require the same tests without duplicating them.

**Files:**
- Create: `.github/workflows/tests.yml`
- Modify: `.github/workflows/ci.yml` (full rewrite)

**Interfaces:**
- Produces: a reusable workflow callable as `uses: ./.github/workflows/tests.yml`, with jobs `backend` and `frontend`. Tasks 6 and 7 depend on its job-level result being available as `needs.tests.result`.

- [ ] **Step 1: Create the reusable tests workflow**

Create `.github/workflows/tests.yml`. The two jobs are copied verbatim from the current `ci.yml` — only the `on:` trigger and the removal of `concurrency` differ (the caller owns concurrency).

```yaml
name: Tests

on:
  workflow_call:

permissions:
  contents: read

jobs:
  backend:
    name: Backend
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    env:
      DJANGO_SECRET_KEY: ci-only-secret-key-with-more-than-thirty-two-bytes
      DJANGO_DEBUG: "True"
      DATABASE_URL: ""
      ORACLE_DB_USER: ""
      ORACLE_DB_PASSWORD: ""
      ORACLE_DB_DSN: ""
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-python@v7
        with:
          python-version: "3.12"
          cache: pip
          cache-dependency-path: backend/requirements.txt
      - run: python -m pip install --upgrade pip
      - run: python -m pip install -r requirements.txt
      - run: python manage.py check
      - run: python manage.py makemigrations --check --dry-run
      - run: python manage.py test apps.accounts apps.tasks config

  frontend:
    name: Frontend
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    env:
      NEXT_TELEMETRY_DISABLED: "1"
      DJANGO_API_BASE_URL: http://127.0.0.1:8000
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: "20"
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm test
      - run: npm run lint
      - run: npm run build
```

- [ ] **Step 2: Rewrite ci.yml as a thin caller**

Replace the entire contents of `.github/workflows/ci.yml` with:

```yaml
name: CI

on:
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  tests:
    uses: ./.github/workflows/tests.yml
```

Note the deliberate removal of `push: branches: [main]`. `deploy.yml` (Task 6) runs the same tests on `main`; leaving the push trigger here would run the whole suite twice per merge.

- [ ] **Step 3: Install actionlint and verify both files parse**

```bash
brew install actionlint
cd "/Users/jay/Desktop/Jaehoon Jung/Projects/picking-up"
actionlint
```

Expected: no output (actionlint prints nothing on success). If it reports `workflow call is not allowed`, the `uses:` path is wrong — it must be repo-relative and start with `./`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/tests.yml .github/workflows/ci.yml
git commit -m "ci: extract test jobs into a reusable workflow

deploy.yml needs to run the same tests before shipping, and calling a
reusable workflow keeps one definition instead of two copies. ci.yml
drops its push-to-main trigger because deploy.yml now covers main."
```

- [ ] **Step 5: Prove the PR path still works**

```bash
git push -u origin feat/cicd-pipeline
gh pr create --fill --title "ci: reusable test workflow + keyless GCP auth"
gh pr checks --watch
```

Expected: the `CI / tests / Backend` and `CI / tests / Frontend` checks both pass. Leave the PR open — Task 2 adds one more commit to it before merging.

---

### Task 2: Keyless GitHub → Google Cloud authentication

Creates the Workload Identity Federation trust and a deployer service account, then proves GitHub can authenticate with no JSON key anywhere.

**Files:**
- Create: `.github/workflows/deploy.yml` (minimal first version — auth smoke test only; Tasks 6 and 7 grow it)
- Create: `docs/deployment/gcp-setup.md`

**Interfaces:**
- Produces: repository variables `GCP_WIF_PROVIDER` and `GCP_DEPLOYER_SA`, consumed by every later `google-github-actions/auth@v2` step.

- [ ] **Step 1: Enable the required APIs**

```bash
gcloud services enable \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  secretmanager.googleapis.com \
  --project jfloww-picking-up
```

- [ ] **Step 2: Create the Workload Identity Pool and GitHub provider**

The `attribute-condition` is the security boundary — without it, any GitHub repository in the world could mint tokens for this service account.

```bash
gcloud iam workload-identity-pools create github \
  --location=global \
  --display-name="GitHub Actions" \
  --project jfloww-picking-up

gcloud iam workload-identity-pools providers create-oidc github \
  --location=global \
  --workload-identity-pool=github \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == 'jfloww/picking-up'" \
  --project jfloww-picking-up
```

- [ ] **Step 3: Create the deployer service account and grant its roles**

```bash
gcloud iam service-accounts create github-deployer \
  --display-name="GitHub Actions deployer" \
  --project jfloww-picking-up

SA="github-deployer@jfloww-picking-up.iam.gserviceaccount.com"

for role in \
  roles/run.admin \
  roles/cloudbuild.builds.editor \
  roles/artifactregistry.writer \
  roles/storage.admin \
  roles/logging.viewer
do
  gcloud projects add-iam-policy-binding jfloww-picking-up \
    --member="serviceAccount:${SA}" --role="${role}" --condition=None
done
```

`roles/storage.admin` is needed because `gcloud builds submit` stages the source tarball in the `jfloww-picking-up_cloudbuild` bucket and reads build logs back from it.

- [ ] **Step 4: Let the deployer act as the Cloud Run runtime service account**

Deploying a revision means assigning it a runtime identity, which requires `iam.serviceAccountUser` on that identity.

```bash
gcloud iam service-accounts add-iam-policy-binding \
  723438086234-compute@developer.gserviceaccount.com \
  --member="serviceAccount:github-deployer@jfloww-picking-up.iam.gserviceaccount.com" \
  --role=roles/iam.serviceAccountUser \
  --project jfloww-picking-up
```

- [ ] **Step 5: Bind the GitHub repository to the deployer service account**

```bash
gcloud iam service-accounts add-iam-policy-binding \
  github-deployer@jfloww-picking-up.iam.gserviceaccount.com \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/723438086234/locations/global/workloadIdentityPools/github/attribute.repository/jfloww/picking-up" \
  --project jfloww-picking-up
```

- [ ] **Step 6: Set the GitHub repository variables**

```bash
cd "/Users/jay/Desktop/Jaehoon Jung/Projects/picking-up"
gh variable set GCP_WIF_PROVIDER --body "projects/723438086234/locations/global/workloadIdentityPools/github/providers/github"
gh variable set GCP_DEPLOYER_SA  --body "github-deployer@jfloww-picking-up.iam.gserviceaccount.com"
gh variable list
```

Expected: both variables listed.

- [ ] **Step 7: Write the auth smoke-test workflow**

Create `.github/workflows/deploy.yml`. This is a deliberately minimal first version — it proves authentication and nothing else. Tasks 6 and 7 replace its job list.

```yaml
name: Deploy

on:
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

jobs:
  auth-smoke-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: google-github-actions/auth@v2
        with:
          project_id: jfloww-picking-up
          workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}
          service_account: ${{ vars.GCP_DEPLOYER_SA }}
      - uses: google-github-actions/setup-gcloud@v2
      - name: Prove the deployer can read the service
        run: |
          gcloud run services describe picking-up-api \
            --region us-east4 --format='value(status.url)'
```

`permissions: id-token: write` is what lets the runner request an OIDC token. Without it `auth@v2` fails with `Unable to get ACTIONS_ID_TOKEN_REQUEST_URL`.

- [ ] **Step 8: Commit and run the smoke test**

This workflow must reach `main` before it can be dispatched at all — see the Global Constraints note on the two-PR flow. It is safe to merge: its only trigger is manual and its only action is a read.

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: authenticate to Google Cloud with workload identity federation

Keyless: GitHub mints an OIDC token, GCP exchanges it for short-lived
deployer credentials. No service-account JSON key exists."
git push
gh pr checks --watch
gh pr merge --squash --delete-branch

git checkout main && git pull
gh workflow run deploy.yml
sleep 20 && gh run list --workflow=deploy.yml --limit 1
gh run watch
```

Expected: the job succeeds and prints `https://picking-up-api-723438086234.us-east4.run.app`.

If it fails with `Permission denied on resource` or `unauthorized_client`, the attribute condition or the `principalSet` binding does not match `jfloww/picking-up` exactly — re-check Steps 2 and 5 before continuing.

- [ ] **Step 9: Record the infrastructure and commit**

Create `docs/deployment/gcp-setup.md` documenting what now exists, so the one-time setup is reconstructible. Record identifiers only — never secret values.

```markdown
# GCP setup for CI/CD

One-time infrastructure behind `.github/workflows/deploy.yml`. Created
2026-09-12. Operating procedure lives in `README.md`; this file records
*what exists* so it can be rebuilt or audited.

## Workload Identity Federation

| Thing | Value |
|---|---|
| Pool | `projects/723438086234/locations/global/workloadIdentityPools/github` |
| Provider | `.../providers/github` |
| Issuer | `https://token.actions.githubusercontent.com` |
| Attribute condition | `assertion.repository == 'jfloww/picking-up'` |

The attribute condition is the security boundary: it is what stops any
other GitHub repository from exchanging a token for these credentials.

## Deployer service account

`github-deployer@jfloww-picking-up.iam.gserviceaccount.com`

Project roles: `run.admin`, `cloudbuild.builds.editor`,
`artifactregistry.writer`, `storage.admin` (Cloud Build staging bucket and
logs), `logging.viewer`. Plus `iam.serviceAccountUser` on
`723438086234-compute@developer.gserviceaccount.com`, the Cloud Run runtime
identity, and `iam.workloadIdentityUser` for the repository principalSet.

**No JSON key exists for this account and none should be created.**

## GitHub repository variables

`GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SA`.
```

Start the second branch for the remaining tasks:

```bash
git checkout -b feat/cicd-deploy-jobs
git add docs/deployment/gcp-setup.md
git commit -m "docs: record the workload identity federation setup"
git push -u origin feat/cicd-deploy-jobs
gh pr create --fill --title "ci/cd: deploy on merge to main"
```

---

### Task 3: Move the database credential into Secret Manager

The migration gate runs as a Cloud Run Job that needs `DATABASE_URL`. Putting it in Secret Manager lets the service and the job share one copy, and is what keeps the credential out of GitHub entirely.

**Files:**
- Modify: `docs/deployment/gcp-setup.md`
- No repository code changes.

**Interfaces:**
- Produces: secrets `picking-up-database-url` and `picking-up-django-secret-key`, consumed by the `--set-secrets` flag in Tasks 5 and 6.

- [ ] **Step 1: Extract the current values into the scratchpad without echoing them**

The values move machine-to-machine. Do not `cat` these files.

```bash
SCRATCH="/private/tmp/claude-501/-Users-jay-Desktop-Jaehoon-Jung-Projects-picking-up/73a8aef5-c028-4f76-9b5a-33b200e63071/scratchpad"
mkdir -p "$SCRATCH"
gcloud run services describe picking-up-api --region us-east4 --format=json \
  | python3 -c '
import json, sys, os
scratch = os.environ["SCRATCH"]
env = {e["name"]: e.get("value") for e in json.load(sys.stdin)["spec"]["template"]["spec"]["containers"][0]["env"]}
for name, path in (("DATABASE_URL", "db-url"), ("DJANGO_SECRET_KEY", "secret-key")):
    value = env[name]
    assert value, f"{name} is not a plain env var on the service"
    open(os.path.join(scratch, path), "w").write(value)
    print(f"{name}: {len(value)} chars written")
'
```

Expected: two lines reporting character counts, no values.

- [ ] **Step 2: Create the secrets from those files**

```bash
gcloud secrets create picking-up-database-url \
  --data-file="$SCRATCH/db-url" --replication-policy=automatic --project jfloww-picking-up
gcloud secrets create picking-up-django-secret-key \
  --data-file="$SCRATCH/secret-key" --replication-policy=automatic --project jfloww-picking-up
rm -f "$SCRATCH/db-url" "$SCRATCH/secret-key"
```

- [ ] **Step 3: Grant the runtime service account read access**

```bash
for s in picking-up-database-url picking-up-django-secret-key; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:723438086234-compute@developer.gserviceaccount.com" \
    --role=roles/secretmanager.secretAccessor \
    --project jfloww-picking-up
done
```

- [ ] **Step 4: Switch the service from literal env vars to secret references**

One command, so no revision ever exists without a database URL:

```bash
gcloud run services update picking-up-api --region us-east4 \
  --remove-env-vars DATABASE_URL,DJANGO_SECRET_KEY \
  --set-secrets "DATABASE_URL=picking-up-database-url:latest,DJANGO_SECRET_KEY=picking-up-django-secret-key:latest"
```

If gcloud rejects the combination with a message about a name existing as both an env var and a secret, do it in the Cloud Console instead (Cloud Run → `picking-up-api` → Edit & deploy new revision → Variables & Secrets), which applies both changes in a single revision.

- [ ] **Step 5: Verify the service still works**

```bash
curl -s https://picking-up-api-723438086234.us-east4.run.app/api/health/
```

Expected: `{"status": "ok", "service": "picking-up-api", "version": "0.2.0", "commit": "2810b39", "environment": "production"}` — unchanged, because only *how* the credential is supplied changed.

Confirm the plaintext values are gone:

```bash
gcloud run services describe picking-up-api --region us-east4 --format=json \
  | python3 -c 'import json,sys; print([e["name"] for e in json.load(sys.stdin)["spec"]["template"]["spec"]["containers"][0]["env"] if e.get("value")])'
```

Expected: a list that does **not** contain `DATABASE_URL` or `DJANGO_SECRET_KEY`.

- [ ] **Step 6: Record and commit**

Append to `docs/deployment/gcp-setup.md`:

```markdown
## Secret Manager

| Secret | Holds |
|---|---|
| `picking-up-database-url` | Neon **pooled** connection string for Cloud Run |
| `picking-up-django-secret-key` | Production `DJANGO_SECRET_KEY` |

Read by `723438086234-compute@developer.gserviceaccount.com` (the Cloud Run
runtime identity) via `roles/secretmanager.secretAccessor`. Both the
`picking-up-api` service and the `picking-up-api-migrate` job reference
them with `--set-secrets NAME=<secret>:latest`, so there is exactly one
copy of each credential. Rotate by adding a new secret version; revisions
pinned to `:latest` pick it up on their next deploy.
```

```bash
git add docs/deployment/gcp-setup.md
git commit -m "docs: record the secret manager move for db credentials"
```

---

### Task 4: Allow the candidate revision's hostname

A `candidate`-tagged revision answers on a different hostname. `ALLOWED_HOSTS` is a strict list (`backend/config/settings.py:34`), so without this the health check in Task 6 gets a `400` and every deploy fails.

**Files:**
- Modify: `docs/deployment/gcp-setup.md`
- No repository code changes.

**Interfaces:**
- Produces: a reachable `https://candidate---picking-up-api-723438086234.us-east4.run.app/api/health/`, consumed by Task 6's health-check step.

- [ ] **Step 1: Confirm the failure mode first, so the fix is proven rather than assumed**

Tag the currently-running image as a no-traffic candidate:

```bash
gcloud run deploy picking-up-api --region us-east4 \
  --image us-east4-docker.pkg.dev/jfloww-picking-up/picking-up/backend:2810b39 \
  --no-traffic --tag candidate

curl -s -o /dev/null -w '%{http_code}\n' \
  https://candidate---picking-up-api-723438086234.us-east4.run.app/api/health/
```

Expected: `400`. That is Django's `DisallowedHost` rejection, and it is exactly what would break the pipeline.

- [ ] **Step 2: Add all four hostnames to ALLOWED_HOSTS and CSRF trusted origins**

**Cloud Run answers on two hostname formats and they are not interchangeable.** The
service has both a project-number host
(`picking-up-api-723438086234.us-east4.run.app`) and a legacy hash host
(`picking-up-api-63ks3zx4gq-uk.a.run.app`). `gcloud run services describe
--format='value(status.url)'` returns the **hash** form — which is what Task 6's health
check derives the candidate URL from. Listing only the project-number form makes every
deploy fail at the health check with `400`.

Verified on 2026-09-12: the project-number host returns `200`, the hash host returns
`400`, against the same live revision.

All four entries are therefore required — both formats, service and candidate. The values
contain commas, so gcloud's alternate-delimiter syntax (`^;^`) is required; without it
gcloud splits each list into separate variables.

```bash
gcloud run services update picking-up-api --region us-east4 \
  --update-env-vars "^;^DJANGO_ALLOWED_HOSTS=picking-up-api-723438086234.us-east4.run.app,candidate---picking-up-api-723438086234.us-east4.run.app,picking-up-api-63ks3zx4gq-uk.a.run.app,candidate---picking-up-api-63ks3zx4gq-uk.a.run.app;DJANGO_CSRF_TRUSTED_ORIGINS=https://picking-up-api-723438086234.us-east4.run.app,https://candidate---picking-up-api-723438086234.us-east4.run.app,https://picking-up-api-63ks3zx4gq-uk.a.run.app,https://candidate---picking-up-api-63ks3zx4gq-uk.a.run.app"
```

- [ ] **Step 3: Re-tag the candidate onto the new revision and verify**

The update in Step 2 created a fresh revision; move the tag to it and re-check:

```bash
gcloud run deploy picking-up-api --region us-east4 \
  --image us-east4-docker.pkg.dev/jfloww-picking-up/picking-up/backend:2810b39 \
  --no-traffic --tag candidate

for h in \
  candidate---picking-up-api-723438086234.us-east4.run.app \
  candidate---picking-up-api-63ks3zx4gq-uk.a.run.app
do
  printf '%-55s ' "$h"
  curl -s -o /dev/null -w '%{http_code}\n' --max-time 15 "https://$h/api/health/"
done
```

Expected: `200` from **both**. The hash-format host is the one Task 6 will actually
request, so a `200` on the project-number host alone does not prove the pipeline works. Compare against the live URL to confirm production traffic never moved:

```bash
gcloud run services describe picking-up-api --region us-east4 \
  --format='value(status.traffic)'
```

Expected: 100% of traffic still on the pre-existing revision; the candidate carries the tag with `percent: 0`.

- [ ] **Step 4: Record and commit**

Append to `docs/deployment/gcp-setup.md`:

```markdown
## Candidate revision hostname

`DJANGO_ALLOWED_HOSTS` and `DJANGO_CSRF_TRUSTED_ORIGINS` list **four** hosts:
the service and its `candidate---` tag, each in both of Cloud Run's hostname
formats — the project-number form
(`picking-up-api-723438086234.us-east4.run.app`) and the legacy hash form
(`picking-up-api-63ks3zx4gq-uk.a.run.app`). `gcloud run services describe
--format='value(status.url)'` returns the hash form, which is what the
pipeline's health check uses.

`deploy.yml` ships each release as a no-traffic revision tagged
`candidate` and health-checks it on that hostname before promoting.
`ALLOWED_HOSTS` is a strict list (`backend/config/settings.py:34`), so
removing the candidate entry makes every deploy fail with `400`.

Update both when setting `--update-env-vars`, using gcloud's `^;^`
alternate delimiter — the values contain commas.
```

```bash
git add docs/deployment/gcp-setup.md
git commit -m "docs: allow the candidate hostname for pre-promotion health checks"
```

---

### Task 5: The migration gate

Creates the Cloud Run Job that runs `migrate --check` against the new image. The pending focus-areas migration (`0016_focussettings`, unapplied in production) gives a real failing case to prove the gate against — no throwaway migration needed.

**Files:**
- Modify: `docs/deployment/gcp-setup.md`
- No repository code changes.

**Interfaces:**
- Produces: Cloud Run Job `picking-up-api-migrate`, invoked by Task 6's gate step with `gcloud run jobs deploy … --execute-now --wait`.

- [ ] **Step 1: Build an image of the current HEAD**

```bash
cd "/Users/jay/Desktop/Jaehoon Jung/Projects/picking-up/backend"
SHA=$(git rev-parse HEAD)
gcloud builds submit --tag "us-east4-docker.pkg.dev/jfloww-picking-up/picking-up/backend:${SHA}"
```

Expected: `SUCCESS`. This image contains `0016_focussettings`, which production has not applied.

- [ ] **Step 2: Create the job and execute it — expecting failure**

```bash
gcloud run jobs deploy picking-up-api-migrate \
  --image "us-east4-docker.pkg.dev/jfloww-picking-up/picking-up/backend:${SHA}" \
  --region us-east4 \
  --command=python \
  --args="manage.py,migrate,--check" \
  --set-secrets "DATABASE_URL=picking-up-database-url:latest,DJANGO_SECRET_KEY=picking-up-django-secret-key:latest" \
  --set-env-vars "DJANGO_DEBUG=False,DJANGO_NUM_PROXIES=1,DJANGO_ALLOWED_HOSTS=localhost,DJANGO_ENVIRONMENT=production" \
  --max-retries 0 \
  --execute-now --wait
```

Expected: **the execution fails.** That is the gate working. `--command=python --args="…"` uses the `=` form deliberately: `--args --check` without it is parsed by gcloud as a flag. `--max-retries 0` makes it fail once instead of retrying three times. `DJANGO_NUM_PROXIES=1` is required or Django refuses to start at all (`backend/config/settings.py:165-172`).

Read the execution log to confirm it failed for the right reason:

```bash
gcloud run jobs executions list --job picking-up-api-migrate --region us-east4 --limit 1
gcloud logging read \
  'resource.type=cloud_run_job AND resource.labels.job_name=picking-up-api-migrate' \
  --limit 20 --format='value(textPayload)' --project jfloww-picking-up
```

Expected: output naming unapplied migration(s) in `tasks`, not a connection or configuration error. **If it failed for any other reason, stop and fix that before continuing** — a gate that fails for the wrong reason is worse than no gate.

- [ ] **Step 3: Apply the pending migration deliberately, by hand**

This is the manual step the whole design is built to protect. It writes to the production database.

```bash
cd "/Users/jay/Desktop/Jaehoon Jung/Projects/picking-up/backend"
.venv/bin/python manage.py showmigrations tasks | tail -5
```

Expected: `0016_focussettings` shown as `[ ]` (unapplied).

```bash
.venv/bin/python manage.py migrate
```

Expected: `Applying tasks.0016_focussettings... OK`. The migration is a plain `CreateModel` — additive, so the currently running revision is unaffected by it.

- [ ] **Step 4: Re-run the job and confirm the gate now passes**

```bash
gcloud run jobs execute picking-up-api-migrate --region us-east4 --wait
```

Expected: the execution succeeds. The gate has now been observed in both states, which is the only way to know it discriminates.

- [ ] **Step 5: Record and commit**

Append to `docs/deployment/gcp-setup.md`:

```markdown
## Migration gate job

Cloud Run Job `picking-up-api-migrate` runs `python manage.py migrate
--check` and nothing else. `deploy.yml` re-points it at each newly built
image and executes it before deploying; a non-zero exit means the database
is missing migrations the new code expects, and the release stops.

It runs in GCP rather than in GitHub Actions so that `DATABASE_URL` is read
from Secret Manager by the runtime identity — GitHub is granted permission
to *launch* the job, never to read the credential.

`--max-retries 0` (fail once, not three times) and `--command=python
--args="manage.py,migrate,--check"` (the `=` form, or gcloud parses
`--check` as its own flag) both matter.

Verified in both directions on 2026-09-12: failed against production with
`tasks.0016_focussettings` unapplied, passed after `manage.py migrate`.
```

```bash
git add docs/deployment/gcp-setup.md
git commit -m "docs: record the migration gate job and its two-state proof"
```

---

### Task 6: Backend deploy job

Replaces the smoke test with the real backend pipeline: change detection, tests, build, gate, candidate, health check, promote.

**Files:**
- Modify: `.github/workflows/deploy.yml` (full rewrite)

**Interfaces:**
- Consumes: `vars.GCP_WIF_PROVIDER`, `vars.GCP_DEPLOYER_SA` (Task 2); secrets `picking-up-database-url`, `picking-up-django-secret-key` (Task 3); the candidate hostname (Task 4); job `picking-up-api-migrate` (Task 5); reusable workflow `tests.yml` (Task 1).
- Produces: jobs `changes` (outputs `backend`, `frontend`), `tests`, and `backend`, which Task 7's frontend job declares in its `needs:`.

- [ ] **Step 1: Rewrite deploy.yml**

Replace the entire contents of `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      dry_run:
        description: "Build, gate and health-check, but do not shift traffic"
        type: boolean
        default: false

permissions:
  contents: read
  id-token: write

concurrency:
  group: deploy-production
  cancel-in-progress: false

env:
  GCP_PROJECT_ID: jfloww-picking-up
  GCP_REGION: us-east4
  SERVICE: picking-up-api
  MIGRATE_JOB: picking-up-api-migrate
  IMAGE_REPO: us-east4-docker.pkg.dev/jfloww-picking-up/picking-up/backend

jobs:
  changes:
    name: Detect changes
    runs-on: ubuntu-latest
    outputs:
      backend: ${{ steps.filter.outputs.backend }}
      frontend: ${{ steps.filter.outputs.frontend }}
    steps:
      - uses: actions/checkout@v7
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            backend:
              - 'backend/**'
            frontend:
              - 'frontend/**'

  tests:
    name: Tests
    needs: changes
    uses: ./.github/workflows/tests.yml

  backend:
    name: Backend
    needs: [changes, tests]
    if: needs.changes.outputs.backend == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Compute image tag and short SHA
        id: vars
        run: |
          echo "image=${IMAGE_REPO}:${GITHUB_SHA}" >> "$GITHUB_OUTPUT"
          echo "short_sha=$(git rev-parse --short=7 HEAD)" >> "$GITHUB_OUTPUT"

      - uses: google-github-actions/auth@v2
        with:
          project_id: ${{ env.GCP_PROJECT_ID }}
          workload_identity_provider: ${{ vars.GCP_WIF_PROVIDER }}
          service_account: ${{ vars.GCP_DEPLOYER_SA }}

      - uses: google-github-actions/setup-gcloud@v2

      - name: Build the image
        working-directory: backend
        run: gcloud builds submit --tag "${{ steps.vars.outputs.image }}"

      - name: Migration gate
        run: |
          set +e
          gcloud run jobs deploy "$MIGRATE_JOB" \
            --image "${{ steps.vars.outputs.image }}" \
            --region "$GCP_REGION" \
            --command=python \
            --args="manage.py,migrate,--check" \
            --set-secrets "DATABASE_URL=picking-up-database-url:latest,DJANGO_SECRET_KEY=picking-up-django-secret-key:latest" \
            --set-env-vars "DJANGO_DEBUG=False,DJANGO_NUM_PROXIES=1,DJANGO_ALLOWED_HOSTS=localhost,DJANGO_ENVIRONMENT=production" \
            --max-retries 0 \
            --execute-now --wait
          status=$?
          set -e
          if [ "$status" -ne 0 ]; then
            echo "::error::Unapplied migrations detected. Run them before deploying: cd backend && python manage.py migrate  (see docs/deployment/README.md section 3)"
            exit 1
          fi

      - name: Deploy the candidate revision with no traffic
        run: |
          gcloud run deploy "$SERVICE" \
            --image "${{ steps.vars.outputs.image }}" \
            --region "$GCP_REGION" \
            --no-traffic --tag candidate \
            --update-env-vars "DJANGO_GIT_SHA=${{ steps.vars.outputs.short_sha }},DJANGO_ENVIRONMENT=production"

      - name: Health-check the candidate
        run: |
          base=$(gcloud run services describe "$SERVICE" --region "$GCP_REGION" --format='value(status.url)')
          url="${base/https:\/\//https://candidate---}/api/health/"
          echo "Checking $url"
          body=""
          for attempt in 1 2 3 4 5; do
            if body=$(curl -fsS --max-time 15 "$url"); then break; fi
            echo "attempt ${attempt} failed, retrying in 5s"
            sleep 5
          done
          echo "$body"
          if ! echo "$body" | grep -q '"status": "ok"'; then
            echo "::error::Candidate revision is not healthy. Traffic was not moved."
            exit 1
          fi
          if ! echo "$body" | grep -q "\"commit\": \"${{ steps.vars.outputs.short_sha }}\""; then
            echo "::error::Candidate reports a different commit than the one being deployed. Traffic was not moved."
            exit 1
          fi

      - name: Promote the candidate to 100% traffic
        if: ${{ github.event.inputs.dry_run != 'true' }}
        run: |
          gcloud run services update-traffic "$SERVICE" \
            --region "$GCP_REGION" --to-tags candidate=100

      - name: Dry run — traffic deliberately not moved
        if: ${{ github.event.inputs.dry_run == 'true' }}
        run: echo "dry_run=true - candidate is healthy, traffic left on the previous revision."
```

The health check derives the candidate hostname from the service URL rather than hardcoding the project number, and asserts the reported commit matches — proving the promoted revision is the one just built rather than a stale revision answering.

- [ ] **Step 2: Lint**

```bash
cd "/Users/jay/Desktop/Jaehoon Jung/Projects/picking-up"
actionlint
```

Expected: no output.

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: deploy the backend to cloud run on merge to main

Builds a SHA-tagged image, refuses to continue when migrations are
unapplied, ships a no-traffic candidate revision, health-checks it, and
only then shifts traffic. Every failure leaves production untouched."
git push
```

- [ ] **Step 4: Run it as a dry run and watch every gate**

```bash
gh workflow run deploy.yml --ref feat/cicd-deploy-jobs -f dry_run=true
sleep 20 && gh run watch
```

Expected: `changes` and `tests` pass, `backend` builds, the gate passes (migrations were applied in Task 5), the candidate is healthy, and the final step prints the dry-run message instead of promoting.

- [ ] **Step 5: Confirm production traffic did not move**

```bash
curl -s https://picking-up-api-723438086234.us-east4.run.app/api/health/
```

Expected: still reports `"commit": "2810b39"`. The dry run proved the whole pipeline without releasing anything.

---

### Task 7: Frontend deploy job

**Files:**
- Modify: `.github/workflows/deploy.yml` (add one job)

**Interfaces:**
- Consumes: `needs.changes.outputs.frontend`, `needs.tests.result`, `needs.backend.result` (Task 6); repository secret `VERCEL_TOKEN`; variables `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

- [ ] **Step 1: Create a Vercel token and store it**

Create a token at https://vercel.com/account/settings/tokens (scope: the `pickingup` project's team; expiration: your choice — note it, because the pipeline breaks silently on expiry).

```bash
cd "/Users/jay/Desktop/Jaehoon Jung/Projects/picking-up"
gh secret set VERCEL_TOKEN          # paste when prompted; never pass --body on the command line
gh variable set VERCEL_ORG_ID     --body "team_1Br2PFa6QEsQoy8nGOgkEaFY"
gh variable set VERCEL_PROJECT_ID --body "prj_alZYqY6wMs3XsnZPY5q4StL0IKFJ"
```

Those two IDs are the contents of `frontend/.vercel/project.json`.

- [ ] **Step 2: Add the frontend job**

Append to the `jobs:` block of `.github/workflows/deploy.yml`:

```yaml
  frontend:
    name: Frontend
    needs: [changes, tests, backend]
    if: |
      always()
      && needs.changes.outputs.frontend == 'true'
      && needs.tests.result == 'success'
      && needs.backend.result != 'failure'
      && needs.backend.result != 'cancelled'
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    env:
      VERCEL_ORG_ID: ${{ vars.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ vars.VERCEL_PROJECT_ID }}
      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: "20"
      - run: npm install -g vercel@58
      - name: Pull the production environment
        run: vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
      - name: Build
        run: vercel build --prod --token="$VERCEL_TOKEN"
      - name: Deploy the prebuilt output
        if: ${{ github.event.inputs.dry_run != 'true' }}
        run: vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN"
      - name: Dry run — build only
        if: ${{ github.event.inputs.dry_run == 'true' }}
        run: echo "dry_run=true - built successfully, deploy skipped."
```

`always()` is required because `backend` is skipped on frontend-only releases, and a skipped dependency would otherwise skip this job too. The explicit `needs.tests.result == 'success'` re-asserts the test gate, which `always()` would otherwise waive.

- [ ] **Step 3: Lint and commit**

```bash
cd "/Users/jay/Desktop/Jaehoon Jung/Projects/picking-up"
actionlint
git add .github/workflows/deploy.yml
git commit -m "ci: deploy the frontend to vercel from the same pipeline

Builds in CI and uploads a prebuilt artifact, so the deployed bundle is
the one the pipeline validated rather than a second independent build."
git push
```

- [ ] **Step 4: Dry-run the full pipeline**

```bash
gh workflow run deploy.yml --ref feat/cicd-deploy-jobs -f dry_run=true
sleep 20 && gh run watch
```

Expected: both `backend` and `frontend` run, both stop at their dry-run step. If `vercel pull` fails with `Project not found`, the org/project IDs or the token's team scope are wrong.

---

### Task 8: First real release and documentation

Ships the focus-areas release through the pipeline, and brings the deployment docs in line with what now exists.

**Files:**
- Modify: `docs/deployment/README.md`
- Delete: `frontend/.vercel.bak/`

- [ ] **Step 1: Update the deployment guide**

In `docs/deployment/README.md`:

1. **Fix the stale Vercel identifiers** in the architecture table and §1: the project is `pickingup` (not `jflowws-projects/frontend`), and `https://frontend-liard-seven-91.vercel.app` now 307-redirects to `https://pickingup.vercel.app/`.
2. **Add a new §0, "Deploying (the normal path)"**, before the existing manual sections:

```markdown
## 0. Deploying (the normal path)

Merge to `main`. `.github/workflows/deploy.yml` runs the tests, builds a
SHA-tagged image, refuses to continue if migrations are unapplied, ships a
no-traffic `candidate` revision, health-checks it, and promotes it. The
frontend deploys from the same run. Only the halves you actually changed
deploy.

**Schema changes still need you first.** Run `cd backend && python
manage.py migrate` (section 3) *before* merging code that depends on the
new schema — otherwise the gate stops the release, which is the intended
behavior, not a bug.

Watch a release: `gh run watch`. Dry-run without shipping:
`gh workflow run deploy.yml -f dry_run=true`.

The manual commands in sections 1–2 remain correct and are the break-glass
procedure when the pipeline is unavailable. Rollback is unchanged and
still manual (section 4). Infrastructure behind the pipeline is recorded
in `gcp-setup.md`.
```

3. **Amend "Not yet set up"**: remove the auto-deploy and GitHub Actions/OIDC bullets; keep manual migrations, PR previews, custom domains, the shared auth-throttle cache, and the OCI decommission. Add a line noting `VERCEL_TOKEN` expiry as a maintenance item.

- [ ] **Step 2: Remove the stray Vercel directory**

`frontend/.vercel.bak/` is byte-identical to the live `frontend/.vercel/` and is untracked clutter.

```bash
cd "/Users/jay/Desktop/Jaehoon Jung/Projects/picking-up"
diff -r frontend/.vercel frontend/.vercel.bak && rm -rf frontend/.vercel.bak
```

Expected: `diff` reports nothing, then the directory is removed. If `diff` reports differences, stop and inspect rather than deleting.

- [ ] **Step 3: Commit and merge the PR**

```bash
git add docs/deployment/README.md
git commit -m "docs: document the automatic deploy path"
git push
gh pr checks --watch
gh pr merge --squash
```

- [ ] **Step 4: Watch the first real release**

The merge to `main` triggers `deploy.yml` for real.

```bash
gh run watch
```

Expected: tests pass, gate passes (migration applied in Task 5), candidate healthy, traffic promoted, frontend deployed.

- [ ] **Step 5: Verify the release actually landed**

```bash
git checkout main && git pull
curl -s https://picking-up-api-723438086234.us-east4.run.app/api/health/
echo "expected commit: $(git rev-parse --short=7 HEAD)"
curl -s -o /dev/null -w '%{http_code}\n' https://pickingup.vercel.app/
```

Expected: the health endpoint's `commit` equals the short SHA of `main`, and the frontend returns `200`. The focus-areas feature is then live on both halves.

- [ ] **Step 6: Confirm the path filter works**

```bash
gh run list --workflow=deploy.yml --limit 3
```

Then push a docs-only commit to `main` and confirm the resulting run skips both the `backend` and `frontend` jobs — the last remaining piece of the design that has not been observed working.

- [ ] **Step 7 (optional, flag to the user first): CORS origin drift**

`DJANGO_CORS_ALLOWED_ORIGINS` is still `https://frontend-liard-seven-91.vercel.app` while the frontend now serves from `https://pickingup.vercel.app`. It causes no visible breakage today because the browser never calls Django directly — Next.js route handlers do, server-side. It is nonetheless stale, and is out of this plan's scope. Raise it rather than fixing it silently.

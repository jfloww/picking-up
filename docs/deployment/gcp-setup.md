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

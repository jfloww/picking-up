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

Verified 2026-09-12: before the change the candidate host returned `400`;
after it, both candidate hostnames return `200` while traffic stayed 100%
on the previously serving revision.

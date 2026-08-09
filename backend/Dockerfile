# Pinned to match backend/.python-version (3.12.12) and CI's setup-python
# (.github/workflows/ci.yml) — do not bump the minor version arbitrarily.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

# Copied and installed before the rest of the source so this layer is
# cached across builds that only change application code.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# collectstatic needs Django to boot, which needs DEBUG=True or a real
# DJANGO_SECRET_KEY + DJANGO_NUM_PROXIES (see config/settings.py's startup
# checks) — neither exists at build time. These values are scoped to this
# one RUN instruction only, not baked into the final image's environment;
# the running container still gets its real DJANGO_SECRET_KEY etc. from
# Cloud Run / `docker run -e`.
RUN DJANGO_DEBUG=True DJANGO_SECRET_KEY=docker-build-time-only-not-a-real-secret \
    python manage.py collectstatic --noinput

RUN useradd --create-home --uid 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8080

# Shell form (not JSON array) so $PORT expands at container start — Cloud
# Run injects it at runtime, the ENV above is only a local-run fallback.
# `exec` replaces the shell with gunicorn as PID 1 so it receives SIGTERM
# directly for graceful shutdown instead of the wrapping shell eating it.
#
# migrate deliberately does not run here — see docs/db-migration/cloud-run-deployment.md
# for why (concurrent container starts would race migrations against Neon).
CMD exec gunicorn --bind 0.0.0.0:$PORT config.wsgi:application

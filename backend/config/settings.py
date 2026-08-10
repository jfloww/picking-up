from datetime import timedelta
from pathlib import Path

import environ
from django.core.exceptions import ImproperlyConfigured


BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
)
# .env wins over .env.development when both exist (read_env does not
# overwrite values that are already set). Missing files are skipped.
environ.Env.read_env(BASE_DIR / ".env")
environ.Env.read_env(BASE_DIR / ".env.development")

_INSECURE_DEFAULT_SECRET_KEY = "dev-only-insecure-secret-key-change-before-production-64-bytes"

SECRET_KEY = env("DJANGO_SECRET_KEY", default=_INSECURE_DEFAULT_SECRET_KEY)
DEBUG = env("DJANGO_DEBUG")

if not DEBUG and SECRET_KEY == _INSECURE_DEFAULT_SECRET_KEY:
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY must be set to a real secret when DJANGO_DEBUG=False. "
        "Generate one with: python -c \"from django.core.management.utils import "
        "get_random_secret_key; print(get_random_secret_key())\""
    )

APP_VERSION = (BASE_DIR / "VERSION").read_text().strip()
DJANGO_GIT_SHA = env("DJANGO_GIT_SHA", default="unknown")
DJANGO_ENVIRONMENT = env("DJANGO_ENVIRONMENT", default="unknown")

ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

# nginx terminates TLS and proxies to gunicorn over plain HTTP, setting
# X-Forwarded-Proto so Django knows the original request was HTTPS —
# without this, request.is_secure() is always False behind the proxy, and
# CsrfViewMiddleware rejects same-origin POSTs (e.g. admin login) with
# "Origin checking failed" because it computes an http:// expected origin.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
CSRF_TRUSTED_ORIGINS = env.list("DJANGO_CSRF_TRUSTED_ORIGINS", default=[])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "apps.accounts",
    "apps.tasks",
]

MIDDLEWARE = [
    # First, so every log call made while handling this request — including
    # ones inside middleware below it — can pick up the correlation ID.
    "config.middleware.RequestIdMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASE_URL = env("DATABASE_URL", default=None)

ORACLE_DB_USER = env("ORACLE_DB_USER", default=None)
ORACLE_DB_PASSWORD = env("ORACLE_DB_PASSWORD", default=None)
ORACLE_DB_DSN = env("ORACLE_DB_DSN", default=None)

if ORACLE_DB_USER and ORACLE_DB_PASSWORD and ORACLE_DB_DSN:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.oracle",
            "NAME": ORACLE_DB_DSN,
            "USER": ORACLE_DB_USER,
            "PASSWORD": ORACLE_DB_PASSWORD,
        }
    }
elif DATABASE_URL:
    DATABASES = {
        "default": env.db("DATABASE_URL"),
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

AUTHENTICATION_BACKENDS = [
    "apps.accounts.backends.EmailBackend",
    "django.contrib.auth.backends.ModelBackend",
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOWED_ORIGINS = env.list(
    "DJANGO_CORS_ALLOWED_ORIGINS",
    default=["http://localhost:3000"],
)
CORS_ALLOW_CREDENTIALS = True

# Development runs in one process, while production's file cache is shared by
# all gunicorn workers on the documented single VM. A multi-host deployment
# must replace this backend with a shared service such as Redis.
if DEBUG:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "picking-up-development",
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.filebased.FileBasedCache",
            "LOCATION": env(
                "DJANGO_CACHE_LOCATION",
                default=str(BASE_DIR / ".cache"),
            ),
            "OPTIONS": {"MAX_ENTRIES": 10_000},
        }
    }

_NUM_PROXIES = env.int("DJANGO_NUM_PROXIES", default=0)

if not DEBUG and _NUM_PROXIES == 0:
    raise ImproperlyConfigured(
        "DJANGO_NUM_PROXIES must be set to the number of trusted proxy hops "
        "when DJANGO_DEBUG=False (see docs/planning/7. deployment-runbook.md). "
        "Left at 0 behind nginx, every request resolves to the same "
        "REMOTE_ADDR (nginx's own address), collapsing every client's auth "
        "throttle into one shared, site-wide bucket (RF-018)."
    )

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    # Trust no forwarding proxy by default. The documented nginx deployment
    # explicitly sets this to one so throttles key on the real client address.
    "NUM_PROXIES": _NUM_PROXIES,
    "DEFAULT_THROTTLE_RATES": {
        "auth_login_burst": env("DJANGO_AUTH_LOGIN_BURST_RATE", default="5/min"),
        "auth_login_sustained": env("DJANGO_AUTH_LOGIN_SUSTAINED_RATE", default="100/day"),
        "auth_register_burst": env("DJANGO_AUTH_REGISTER_BURST_RATE", default="3/min"),
        "auth_register_sustained": env(
            "DJANGO_AUTH_REGISTER_SUSTAINED_RATE", default="20/day"
        ),
        "auth_google_burst": env("DJANGO_AUTH_GOOGLE_BURST_RATE", default="10/min"),
        "auth_google_sustained": env("DJANGO_AUTH_GOOGLE_SUSTAINED_RATE", default="200/day"),
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=14),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
}

# Server-side audience check for Google Sign-In ID tokens. Unset in dev
# until a real OAuth client is created in Google Cloud Console.
GOOGLE_OAUTH_CLIENT_ID = env("GOOGLE_OAUTH_CLIENT_ID", default=None)

# Console-only in production: gunicorn's stdout/stderr already flows into
# journald under this project's systemd deployment (see the deployment
# runbook — `journalctl -u gunicorn` is already the first place operators
# look), and a local rotating file adds nothing there while being actively
# unsafe with more than one worker process. WindowsSafeTimedRotatingFileHandler
# only fixes the Windows dev-autoreloader file-lock problem it was built
# for; TimedRotatingFileHandler itself has no protection against two
# processes rotating the same file at the same moment — each does its own
# rename-based rollover independently, so concurrent gunicorn workers race
# on rollover and can silently drop or corrupt log lines. File logging is
# therefore dev-only here (DEBUG=True), where there is always exactly one
# process writing.
_LOG_HANDLERS = {
    "console": {
        "class": "logging.StreamHandler",
        "formatter": "verbose",
    },
}

if DEBUG:
    LOG_DIR = BASE_DIR / "logs"
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    # Rotates at local midnight: today's log is backend.log, and each
    # previous day is kept as backend.log.YYYY-MM-DD (up to a year back).
    # Uses WindowsSafeTimedRotatingFileHandler, not the stdlib class
    # directly: on Windows, the dev autoreloader's watcher process keeps
    # this file open for the whole `runserver` session, so a plain
    # TimedRotatingFileHandler's rename-based rollover fails with
    # PermissionError every time it's due — and since doRollover() and
    # the actual write share a try block, that silently drops every log
    # record from then on, not just the rotation.
    _LOG_HANDLERS["file"] = {
        "class": "config.logging_handlers.WindowsSafeTimedRotatingFileHandler",
        "filename": LOG_DIR / "backend.log",
        "when": "midnight",
        "backupCount": 365,
        "formatter": "verbose",
        "encoding": "utf-8",
    }
    _LOG_HANDLERS["error_file"] = {
        "class": "config.logging_handlers.WindowsSafeTimedRotatingFileHandler",
        "filename": LOG_DIR / "backend-error.log",
        "when": "midnight",
        "backupCount": 365,
        "level": "ERROR",
        "formatter": "verbose",
        "encoding": "utf-8",
    }

_LOG_HANDLER_NAMES = list(_LOG_HANDLERS)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "request_id": {
            "()": "config.middleware.RequestIdLogFilter",
        },
    },
    "formatters": {
        "verbose": {
            # e.g. "[20260720 222217] ERROR - a1b2c3d4 - accounts.views.post:112 - Invalid Google credential."
            "format": "[{asctime}] {levelname} - {request_id} - {module}.{funcName}:{lineno} - {message}",
            "style": "{",
            "datefmt": "%Y%m%d %H%M%S",
        },
    },
    "handlers": {
        name: {**config, "filters": ["request_id"]} for name, config in _LOG_HANDLERS.items()
    },
    "root": {
        "handlers": _LOG_HANDLER_NAMES,
        "level": "INFO",
    },
    "loggers": {
        "django": {
            "handlers": _LOG_HANDLER_NAMES,
            "level": "INFO",
            "propagate": False,
        },
        "django.request": {
            "handlers": _LOG_HANDLER_NAMES,
            "level": "WARNING",
            "propagate": False,
        },
        "django.db.backends": {
            "handlers": _LOG_HANDLER_NAMES,
            "level": "WARNING",
            "propagate": False,
        },
        "apps": {
            "handlers": _LOG_HANDLER_NAMES,
            "level": "DEBUG" if DEBUG else "INFO",
            "propagate": False,
        },
    },
}

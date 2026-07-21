import logging
import os
import sys

from django.apps import AppConfig

logger = logging.getLogger("apps.accounts")


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.accounts"

    def ready(self):
        # Only log the startup status once, when `runserver` actually starts
        # serving — not for `migrate`/`test`/etc., and not twice for the
        # autoreloader's parent + child process.
        if "runserver" not in sys.argv or os.environ.get("RUN_MAIN") != "true":
            return

        from django.conf import settings
        from django.db import connection
        from django.db.utils import Error as DjangoDBError

        try:
            connection.ensure_connection()
        except DjangoDBError as exc:
            logger.error(
                "Startup check — database: FAILED to connect (%s)", exc, exc_info=True
            )
        else:
            db_name = connection.settings_dict.get("NAME")
            logger.info(
                "Startup check — database: connected (%s, %s)",
                connection.vendor,
                db_name,
            )

        logger.info(
            "Startup check — server ready, debug mode: %s", settings.DEBUG
        )

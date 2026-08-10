from django.conf import settings
from django.http import JsonResponse


def health(request):
    return JsonResponse(
        {
            "status": "ok",
            "service": "picking-up-api",
            "version": settings.APP_VERSION,
            "commit": settings.DJANGO_GIT_SHA,
            "environment": settings.DJANGO_ENVIRONMENT,
        }
    )

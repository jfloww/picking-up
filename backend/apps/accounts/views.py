from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from google.auth.exceptions import GoogleAuthError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import GoogleIdentity
from .serializers import EmailTokenObtainPairSerializer, RegisterSerializer, UserSerializer
from .throttles import (
    FirstFailureThrottleMixin,
    GoogleBurstThrottle,
    GoogleSustainedThrottle,
    LoginBurstThrottle,
    LoginSustainedThrottle,
    RegisterBurstThrottle,
    RegisterSustainedThrottle,
)


class RegisterView(FirstFailureThrottleMixin, generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = (permissions.AllowAny,)
    throttle_classes = (RegisterBurstThrottle, RegisterSustainedThrottle)


class MeView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def get(self, request):
        serializer = UserSerializer(request.user)
        return Response(serializer.data)


class EmailTokenObtainPairView(FirstFailureThrottleMixin, TokenObtainPairView):
    serializer_class = EmailTokenObtainPairSerializer
    throttle_classes = (LoginBurstThrottle, LoginSustainedThrottle)


class LogoutView(APIView):
    permission_classes = (permissions.AllowAny,)

    def post(self, request):
        refresh_token = request.data.get("refresh")

        if not refresh_token:
            return Response(
                {"detail": "Refresh token is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            RefreshToken(refresh_token).blacklist()
        except TokenError:
            pass

        return Response(status=status.HTTP_205_RESET_CONTENT)


User = get_user_model()


class GoogleTokenObtainView(FirstFailureThrottleMixin, APIView):
    permission_classes = (permissions.AllowAny,)
    throttle_classes = (GoogleBurstThrottle, GoogleSustainedThrottle)

    def post(self, request):
        origin = request.headers.get("Origin")
        if origin and origin not in settings.CORS_ALLOWED_ORIGINS:
            return Response({"error": "Invalid origin."}, status=status.HTTP_403_FORBIDDEN)

        credential = request.data.get("credential")
        if not credential:
            return Response({"error": "Missing Google credential."}, status=status.HTTP_400_BAD_REQUEST)

        if not settings.GOOGLE_OAUTH_CLIENT_ID:
            return Response(
                {"error": "Google sign-in is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        try:
            claims = google_id_token.verify_oauth2_token(
                credential, google_requests.Request(), audience=settings.GOOGLE_OAUTH_CLIENT_ID
            )
        except (ValueError, GoogleAuthError):
            return Response({"error": "Invalid Google credential."}, status=status.HTTP_400_BAD_REQUEST)

        if not claims.get("email_verified"):
            return Response({"error": "Google email is not verified."}, status=status.HTTP_400_BAD_REQUEST)

        sub = claims["sub"]
        email = claims["email"].strip().lower()

        identity = GoogleIdentity.objects.select_related("user").filter(sub=sub).first()
        if identity is not None:
            user = identity.user
        else:
            user = User.objects.filter(email__iexact=email).first()
            if user is None:
                # Wrapped in a transaction so a concurrent sign-in for the same new
                # `sub` can't create two Users: if both requests race past the
                # `filter(sub=sub)` check above, the loser's GoogleIdentity insert
                # hits the unique constraint on `sub` and rolls back its User too,
                # instead of leaving an orphaned User with no linked identity.
                try:
                    with transaction.atomic():
                        user = User.objects.create_user(username=email, email=email)
                        user.set_unusable_password()
                        user.save(update_fields=["password"])
                        GoogleIdentity.objects.create(user=user, sub=sub, email=email)
                except IntegrityError:
                    identity = GoogleIdentity.objects.select_related("user").filter(sub=sub).first()
                    if identity is None:
                        return Response(
                            {"error": "Could not complete Google sign-in."},
                            status=status.HTTP_409_CONFLICT,
                        )
                    user = identity.user
            else:
                # Two first-time requests for the same existing account can
                # both miss the identity lookup above. Let the database choose
                # the winner, then reuse that winner instead of leaking the
                # unique sub/one-to-one IntegrityError as a 500.
                try:
                    with transaction.atomic():
                        GoogleIdentity.objects.create(user=user, sub=sub, email=email)
                except IntegrityError:
                    identity = GoogleIdentity.objects.select_related("user").filter(sub=sub).first()
                    if identity is None:
                        return Response(
                            {"error": "Could not complete Google sign-in."},
                            status=status.HTTP_409_CONFLICT,
                        )
                    user = identity.user

        refresh = RefreshToken.for_user(user)

        return Response(
            {"access": str(refresh.access_token), "refresh": str(refresh)},
            status=status.HTTP_200_OK,
        )

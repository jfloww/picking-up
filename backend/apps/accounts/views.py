from django.conf import settings
from django.contrib.auth import get_user_model
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


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = (permissions.AllowAny,)


class MeView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def get(self, request):
        serializer = UserSerializer(request.user)
        return Response(serializer.data)


class EmailTokenObtainPairView(TokenObtainPairView):
    serializer_class = EmailTokenObtainPairSerializer


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


class GoogleTokenObtainView(APIView):
    permission_classes = (permissions.AllowAny,)

    def post(self, request):
        origin = request.headers.get("Origin")
        if origin and origin not in settings.CORS_ALLOWED_ORIGINS:
            return Response({"error": "Invalid origin."}, status=status.HTTP_403_FORBIDDEN)

        credential = request.data.get("credential")
        if not credential:
            return Response({"error": "Missing Google credential."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            claims = google_id_token.verify_oauth2_token(
                credential, google_requests.Request(), audience=settings.GOOGLE_OAUTH_CLIENT_ID
            )
        except ValueError:
            return Response({"error": "Invalid Google credential."}, status=status.HTTP_400_BAD_REQUEST)

        if not claims.get("email_verified"):
            return Response({"error": "Google email is not verified."}, status=status.HTTP_400_BAD_REQUEST)

        sub = claims["sub"]
        email = claims["email"].strip().lower()

        identity = GoogleIdentity.objects.select_related("user").filter(sub=sub).first()
        if identity is not None:
            user = identity.user
        else:
            user = User.objects.filter(email=email).first()
            if user is None:
                user = User.objects.create_user(username=email, email=email)
                user.set_unusable_password()
                user.save(update_fields=["password"])
            GoogleIdentity.objects.create(user=user, sub=sub, email=email)

        refresh = RefreshToken.for_user(user)

        return Response(
            {"access": str(refresh.access_token), "refresh": str(refresh)},
            status=status.HTTP_200_OK,
        )

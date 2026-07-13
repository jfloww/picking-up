from django.contrib.auth import get_user_model
from django.contrib.auth import authenticate
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework_simplejwt.tokens import RefreshToken


User = get_user_model()


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ("id", "email", "username", "password")
        read_only_fields = ("id",)
        extra_kwargs = {
            "username": {"required": False, "allow_blank": True},
        }

    def validate_email(self, value: str) -> str:
        email = value.strip().lower()

        if not email:
            raise serializers.ValidationError("Email is required.")

        if User.objects.filter(email=email).exists():
            raise serializers.ValidationError("An account with this email already exists.")

        return email

    def validate_password(self, value: str) -> str:
        validate_password(value)
        return value

    def create(self, validated_data):
        email = validated_data["email"]
        username = validated_data.get("username") or email

        return User.objects.create_user(
            username=username,
            email=email,
            password=validated_data["password"],
        )


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "email", "username", "first_name", "last_name")
        read_only_fields = fields


class EmailTokenObtainPairSerializer(serializers.Serializer):
    email = serializers.EmailField(write_only=True)
    password = serializers.CharField(write_only=True)
    access = serializers.CharField(read_only=True)
    refresh = serializers.CharField(read_only=True)

    def validate(self, attrs):
        email = attrs.get("email", "").strip().lower()
        password = attrs.get("password")

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist as exc:
            raise serializers.ValidationError("No active account found with the given credentials.") from exc

        self.user = authenticate(
            self.context["request"],
            username=user.get_username(),
            password=password,
        )

        if self.user is None:
            raise serializers.ValidationError("No active account found with the given credentials.")

        refresh = RefreshToken.for_user(self.user)

        return {
            "refresh": str(refresh),
            "access": str(refresh.access_token),
        }

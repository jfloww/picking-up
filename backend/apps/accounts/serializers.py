from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.db import IntegrityError
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer


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

        # __iexact, not exact: must match EmailBackend's lookup (RF-019) —
        # an exact-match check here would let two case-variant emails both
        # register, which is exactly the ambiguity that later locks both
        # accounts out of password login via MultipleObjectsReturned.
        if User.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("An account with this email already exists.")

        return email

    def validate_password(self, value: str) -> str:
        validate_password(value)
        return value

    def create(self, validated_data):
        email = validated_data["email"]
        username = validated_data.get("username") or email

        try:
            return User.objects.create_user(
                username=username,
                email=email,
                password=validated_data["password"],
            )
        except IntegrityError as exc:
            # The __iexact pre-check in validate_email closes the sequential
            # case, but two concurrent registrations for case-variant emails
            # can both pass that check and race to insert — the database's
            # unique index is the real, atomic boundary (same lesson as
            # RF-007's category race). Convert the loser's IntegrityError
            # into the same validation error the pre-check would have
            # raised, instead of letting it surface as an unhandled 500.
            raise serializers.ValidationError(
                {"email": ["An account with this email already exists."]}
            ) from exc


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "email", "username", "first_name", "last_name")
        read_only_fields = fields


class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Use Simple JWT's normal authentication and token issuance by email."""

    username_field = User.EMAIL_FIELD

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # TokenObtainSerializer installs a generic CharField dynamically. Use
        # EmailField here so malformed identifiers fail before authentication.
        self.fields[self.username_field] = serializers.EmailField(write_only=True)

    def validate_email(self, value: str) -> str:
        return value.strip().lower()

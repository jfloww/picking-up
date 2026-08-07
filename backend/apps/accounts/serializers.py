from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.db import IntegrityError, transaction
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

    def validate_username(self, value: str) -> str:
        # A blank username falls through to the (already-validated) email
        # in create() below, so only a genuinely supplied one needs its own
        # check here — this is what lets create()'s post-failure lookup
        # (see below) tell an email collision apart from a username one.
        if value and User.objects.filter(username=value).exists():
            raise serializers.ValidationError("An account with this username already exists.")
        return value

    def validate_password(self, value: str) -> str:
        validate_password(value)
        return value

    def create(self, validated_data):
        email = validated_data["email"]
        username = validated_data.get("username") or email

        try:
            # Keep the insert in its own savepoint. Without it, catching
            # IntegrityError still leaves the surrounding transaction
            # (a real request's, or a TestCase's) unusable for any further
            # query — including the re-check query below, which would then
            # raise TransactionManagementError instead of the intended
            # validation error.
            with transaction.atomic():
                return User.objects.create_user(
                    username=username,
                    email=email,
                    password=validated_data["password"],
                )
        except IntegrityError as exc:
            # The pre-checks above close the sequential case for both
            # fields, but two concurrent registrations can both pass a
            # pre-check and race to insert — the database's unique indexes
            # are the real, atomic boundary (same lesson as RF-007's
            # category race). Re-check which field actually collided rather
            # than assuming email: username is an exposed, independently
            # unique field on this endpoint, and a blanket "email already
            # exists" would misreport a username-only collision to the
            # client.
            if User.objects.filter(email__iexact=email).exists():
                raise serializers.ValidationError(
                    {"email": ["An account with this email already exists."]}
                ) from exc
            raise serializers.ValidationError(
                {"username": ["An account with this username already exists."]}
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

import re

from django.db import IntegrityError, transaction
from django.db.models import F
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, serializers as drf_serializers, status
from rest_framework.exceptions import APIException, NotFound
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Category, Task, normalize_category_name
from .serializers import (
    CategorySerializer,
    NestTaskCommandSerializer,
    PromoteSubtaskCommandSerializer,
    TaskSerializer,
)
from .services import (
    TaskCommandConflict,
    TaskCommandNotFound,
    TaskVersionConflict,
    nest_task,
    promote_subtask,
)


ETAG_VERSION_PATTERN = re.compile(r'^"([1-9][0-9]*)"$')


class TaskVersionPreconditionRequired(APIException):
    status_code = 428
    default_detail = {
        "code": "task_version_required",
        "detail": 'Send the task version as an If-Match header, for example If-Match: "3".',
    }
    default_code = "task_version_required"


class TaskVersionMalformed(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_detail = {
        "code": "task_version_malformed",
        "detail": 'If-Match must contain one quoted positive integer, for example "3".',
    }
    default_code = "task_version_malformed"


class TaskVersionConflictResponse(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "task_version_conflict"

    def __init__(self, current_versions):
        # APIException.__init__ recursively converts every scalar to an
        # ErrorDetail string. Set detail directly so version tokens remain
        # JSON numbers for clients that use the conflict payload to resync.
        self.detail = {
            "code": "task_version_conflict",
            "detail": "One or more tasks changed after they were loaded.",
            "current_versions": current_versions,
        }
        Exception.__init__(self, self.detail)


class TaskCommandConflictResponse(APIException):
    # Every other Task-command error (missing/malformed If-Match, stale
    # version) is raised as an APIException so it goes through DRF's normal
    # exception handling; TaskCommandConflict used to be converted to a
    # bare Response() instead — same 409 status, a different and
    # inconsistent path to get there. Unify on raising.
    status_code = status.HTTP_409_CONFLICT
    default_code = "task_command_conflict"

    def __init__(self, exc: TaskCommandConflict):
        self.detail = {"code": exc.code, "detail": exc.detail, **exc.extra}
        Exception.__init__(self, self.detail)


def parse_if_match_version(request) -> int:
    raw_value = request.headers.get("If-Match")
    if raw_value is None:
        raise TaskVersionPreconditionRequired
    match = ETAG_VERSION_PATTERN.fullmatch(raw_value.strip())
    if match is None:
        raise TaskVersionMalformed
    return int(match.group(1))


class TaskListCreateView(generics.ListCreateAPIView):
    serializer_class = TaskSerializer
    permission_classes = (permissions.IsAuthenticated,)

    def get_queryset(self):
        return Task.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class TaskDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = TaskSerializer
    permission_classes = (permissions.IsAuthenticated,)

    def get_queryset(self):
        return Task.objects.filter(user=self.request.user)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        response = Response(self.get_serializer(instance).data)
        response["ETag"] = f'"{instance.version}"'
        return response

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        with transaction.atomic():
            instance = get_object_or_404(
                self.get_queryset().select_for_update(),
                pk=kwargs["pk"],
            )
            self.check_object_permissions(request, instance)
            expected_version = parse_if_match_version(request)
            if instance.version != expected_version:
                raise TaskVersionConflictResponse({str(instance.id): instance.version})

            serializer = self.get_serializer(instance, data=request.data, partial=partial)
            serializer.is_valid(raise_exception=True)
            self.perform_update(serializer)

        response = Response(serializer.data)
        response["ETag"] = f'"{serializer.instance.version}"'
        return response

    def destroy(self, request, *args, **kwargs):
        with transaction.atomic():
            instance = get_object_or_404(
                self.get_queryset().select_for_update(),
                pk=kwargs["pk"],
            )
            self.check_object_permissions(request, instance)
            expected_version = parse_if_match_version(request)
            if instance.version != expected_version:
                raise TaskVersionConflictResponse({str(instance.id): instance.version})
            # Deleting a repeat anchor SET_NULLs repeat_source on every
            # generated occurrence via a bulk update, bypassing Task.save()
            # entirely — so without this, a client holding a stale-but-
            # version-matching copy of an occurrence would still pass
            # If-Match after the occurrence's meaning changed underneath it
            # (RF-005 review finding). Bump those occurrences' versions in
            # the same transaction as the delete.
            Task.objects.filter(repeat_source=instance).update(version=F("version") + 1)
            self.perform_destroy(instance)
        return Response(status=status.HTTP_204_NO_CONTENT)


class NestTaskCommandView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request, pk):
        serializer = NestTaskCommandSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            result = nest_task(
                user=request.user,
                source_id=pk,
                target_id=data["target_id"],
                source_version=data["source_version"],
                target_version=data["target_version"],
                subtask_id=data["subtask_id"],
                confirm_data_loss=data["confirm_data_loss"],
            )
        except TaskCommandNotFound as exc:
            raise NotFound from exc
        except TaskVersionConflict as exc:
            raise TaskVersionConflictResponse(exc.current_versions) from exc
        except TaskCommandConflict as exc:
            raise TaskCommandConflictResponse(exc) from exc

        return Response(
            {
                "target": TaskSerializer(result.target, context={"request": request}).data,
                "removed_task_id": result.removed_task_id,
            },
            status=status.HTTP_200_OK,
        )


class PromoteSubtaskCommandView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request, pk):
        serializer = PromoteSubtaskCommandSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            result = promote_subtask(
                user=request.user,
                parent_id=pk,
                subtask_id=data["subtask_id"],
                parent_version=data["parent_version"],
                new_task_id=data["new_task_id"],
            )
        except TaskCommandNotFound as exc:
            raise NotFound from exc
        except TaskVersionConflict as exc:
            raise TaskVersionConflictResponse(exc.current_versions) from exc
        except TaskCommandConflict as exc:
            raise TaskCommandConflictResponse(exc) from exc

        return Response(
            {
                "parent": TaskSerializer(result.parent, context={"request": request}).data,
                "task": TaskSerializer(result.task, context={"request": request}).data,
            },
            status=status.HTTP_201_CREATED,
        )


class CategoryListCreateView(generics.ListCreateAPIView):
    serializer_class = CategorySerializer
    permission_classes = (permissions.IsAuthenticated,)

    def get_queryset(self):
        return Category.objects.filter(user=self.request.user).order_by("created_at")

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        name = serializer.validated_data["name"]
        category, created = Category.objects.get_or_create(
            user=request.user,
            normalized_name=normalize_category_name(name),
            defaults={"name": name},
        )
        response_serializer = self.get_serializer(category)
        return Response(
            response_serializer.data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class CategoryDetailView(generics.UpdateAPIView):
    serializer_class = CategorySerializer
    permission_classes = (permissions.IsAuthenticated,)
    http_method_names = ["patch", "options"]

    def get_queryset(self):
        return Category.objects.filter(user=self.request.user)

    def perform_update(self, serializer):
        try:
            with transaction.atomic():
                serializer.save()
        except IntegrityError as exc:
            raise drf_serializers.ValidationError(
                {"name": ["A category with this name already exists."]}
            ) from exc

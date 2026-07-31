from rest_framework import generics, permissions, serializers as drf_serializers
from rest_framework.response import Response

from .models import Category, Task
from .serializers import CategorySerializer, TaskSerializer


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


class CategoryListCreateView(generics.ListCreateAPIView):
    serializer_class = CategorySerializer
    permission_classes = (permissions.IsAuthenticated,)

    def get_queryset(self):
        return Category.objects.filter(user=self.request.user).order_by("created_at")

    def create(self, request, *args, **kwargs):
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response({"name": ["This field may not be blank."]}, status=400)
        existing = Category.objects.filter(user=request.user, name__iexact=name).first()
        if existing is not None:
            return Response(self.get_serializer(existing).data, status=200)
        serializer = self.get_serializer(data={"name": name})
        serializer.is_valid(raise_exception=True)
        serializer.save(user=request.user)
        return Response(serializer.data, status=201)


class CategoryDetailView(generics.UpdateAPIView):
    serializer_class = CategorySerializer
    permission_classes = (permissions.IsAuthenticated,)
    http_method_names = ["patch", "options"]

    def get_queryset(self):
        return Category.objects.filter(user=self.request.user)

    def perform_update(self, serializer):
        name = (self.request.data.get("name") or "").strip()
        if not name:
            raise drf_serializers.ValidationError({"name": ["This field may not be blank."]})
        conflict = (
            Category.objects.filter(user=self.request.user, name__iexact=name)
            .exclude(pk=self.get_object().pk)
            .exists()
        )
        if conflict:
            raise drf_serializers.ValidationError({"name": ["A category with this name already exists."]})
        serializer.save(name=name)

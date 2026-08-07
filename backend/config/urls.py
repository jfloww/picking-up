from django.contrib import admin
from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from apps.accounts.views import EmailTokenObtainPairView, GoogleTokenObtainView, LogoutView, MeView, RegisterView
from apps.tasks.views import (
    CategoryDetailView,
    CategoryListCreateView,
    NestTaskCommandView,
    PromoteSubtaskCommandView,
    TaskDetailView,
    TaskListCreateView,
)


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/register/", RegisterView.as_view(), name="register"),
    path("api/auth/token/", EmailTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("api/auth/google/", GoogleTokenObtainView.as_view(), name="google_token_obtain"),
    path("api/auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("api/auth/logout/", LogoutView.as_view(), name="logout"),
    path("api/auth/me/", MeView.as_view(), name="me"),
    path("api/tasks/", TaskListCreateView.as_view(), name="task-list-create"),
    path(
        "api/tasks/<uuid:pk>/commands/nest/",
        NestTaskCommandView.as_view(),
        name="task-command-nest",
    ),
    path(
        "api/tasks/<uuid:pk>/commands/promote-subtask/",
        PromoteSubtaskCommandView.as_view(),
        name="task-command-promote-subtask",
    ),
    path("api/tasks/<uuid:pk>/", TaskDetailView.as_view(), name="task-detail"),
    path("api/categories/", CategoryListCreateView.as_view(), name="category-list-create"),
    path("api/categories/<uuid:pk>/", CategoryDetailView.as_view(), name="category-detail"),
]

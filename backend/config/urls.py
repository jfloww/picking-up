from django.contrib import admin
from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from apps.accounts.views import EmailTokenObtainPairView, LogoutView, MeView, RegisterView
from apps.tasks.views import TaskDetailView, TaskListCreateView


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/register/", RegisterView.as_view(), name="register"),
    path("api/auth/token/", EmailTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("api/auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("api/auth/logout/", LogoutView.as_view(), name="logout"),
    path("api/auth/me/", MeView.as_view(), name="me"),
    path("api/tasks/", TaskListCreateView.as_view(), name="task-list-create"),
    path("api/tasks/<uuid:pk>/", TaskDetailView.as_view(), name="task-detail"),
]

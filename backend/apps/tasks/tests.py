import uuid

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from .models import Task


User = get_user_model()


def auth_client(email="owner@example.com", password="StrongPass123!"):
    user = User.objects.create_user(username=email, email=email, password=password)
    client = APIClient()
    token_response = client.post(
        "/api/auth/token/", {"email": email, "password": password}, format="json",
    )
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token_response.data['access']}")
    return user, client


def make_task_payload(**overrides):
    payload = {
        "id": str(uuid.uuid4()),
        "title": "write plan",
        "memo": None,
        "done": False,
        "scope_kind": "day",
        "scope_value": "2026-07-27",
        "rolled_from_kind": None,
        "rolled_from_value": None,
        "created_at": "2026-07-27T00:00:00.000Z",
        "completed_at": None,
        "time": None,
        "due_date": None,
        "subtasks": [],
        "repeat_weekdays": None,
        "repeat_source": None,
        "excluded_dates": None,
        "priority": None,
        "duration_minutes": None,
        "background": None,
    }
    payload.update(overrides)
    return payload


class TaskApiTests(TestCase):
    def test_list_only_returns_the_authenticated_users_own_tasks(self):
        owner, owner_client = auth_client("owner@example.com")
        other, _ = auth_client("other@example.com")
        Task.objects.create(
            id=uuid.uuid4(), user=owner, title="mine",
            scope_kind="day", scope_value="2026-07-27",
            created_at="2026-07-27T00:00:00.000Z",
        )
        Task.objects.create(
            id=uuid.uuid4(), user=other, title="not mine",
            scope_kind="day", scope_value="2026-07-27",
            created_at="2026-07-27T00:00:00.000Z",
        )

        response = owner_client.get("/api/tasks/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual([t["title"] for t in response.data], ["mine"])

    def test_create_round_trips_every_field_including_subtasks_and_repeat_source(self):
        owner, client = auth_client()
        anchor_id = str(uuid.uuid4())
        client.post(
            "/api/tasks/",
            make_task_payload(id=anchor_id, title="anchor", repeat_weekdays=[1, 3, 5]),
            format="json",
        )

        occurrence_id = str(uuid.uuid4())
        response = client.post(
            "/api/tasks/",
            make_task_payload(
                id=occurrence_id,
                title="occurrence",
                memo="details",
                done=True,
                rolled_from_kind="day",
                rolled_from_value="2026-07-20",
                completed_at="2026-07-27T09:00:00.000Z",
                time="09:30",
                due_date="2026-08-01",
                subtasks=[{"id": "s1", "title": "buy wood", "done": False}],
                repeat_source=anchor_id,
                excluded_dates=["2026-07-13"],
                priority=True,
                duration_minutes=45,
                background=True,
            ),
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        stored = Task.objects.get(id=occurrence_id)
        self.assertEqual(stored.title, "occurrence")
        self.assertEqual(stored.memo, "details")
        self.assertTrue(stored.done)
        self.assertEqual(stored.rolled_from_kind, "day")
        self.assertEqual(stored.rolled_from_value, "2026-07-20")
        self.assertEqual(stored.completed_at, "2026-07-27T09:00:00.000Z")
        self.assertEqual(stored.time, "09:30")
        self.assertEqual(stored.due_date, "2026-08-01")
        self.assertEqual(stored.subtasks, [{"id": "s1", "title": "buy wood", "done": False}])
        self.assertEqual(str(stored.repeat_source_id), anchor_id)
        self.assertEqual(stored.excluded_dates, ["2026-07-13"])
        self.assertTrue(stored.priority)
        self.assertEqual(stored.duration_minutes, 45)
        self.assertTrue(stored.background)

    def test_update_fully_replaces_a_tasks_fields(self):
        owner, client = auth_client()
        task_id = str(uuid.uuid4())
        client.post(
            "/api/tasks/",
            make_task_payload(id=task_id, title="before", priority=True),
            format="json",
        )

        response = client.put(
            f"/api/tasks/{task_id}/",
            make_task_payload(id=task_id, title="after", priority=None),
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        stored = Task.objects.get(id=task_id)
        self.assertEqual(stored.title, "after")
        self.assertIsNone(stored.priority)

    def test_delete_removes_the_task(self):
        owner, client = auth_client()
        task_id = str(uuid.uuid4())
        client.post("/api/tasks/", make_task_payload(id=task_id), format="json")

        response = client.delete(f"/api/tasks/{task_id}/")

        self.assertEqual(response.status_code, 204)
        self.assertFalse(Task.objects.filter(id=task_id).exists())

    def test_deleting_an_anchor_nulls_repeat_source_on_its_occurrences_instead_of_deleting_them(self):
        owner, client = auth_client()
        anchor_id = str(uuid.uuid4())
        client.post("/api/tasks/", make_task_payload(id=anchor_id, title="anchor"), format="json")
        occurrence_id = str(uuid.uuid4())
        client.post(
            "/api/tasks/",
            make_task_payload(id=occurrence_id, title="occurrence", repeat_source=anchor_id),
            format="json",
        )

        client.delete(f"/api/tasks/{anchor_id}/")

        occurrence = Task.objects.get(id=occurrence_id)
        self.assertIsNone(occurrence.repeat_source_id)

    def test_unauthenticated_requests_are_rejected(self):
        client = APIClient()

        self.assertEqual(client.get("/api/tasks/").status_code, 401)
        self.assertEqual(
            client.post("/api/tasks/", make_task_payload(), format="json").status_code, 401,
        )

    def test_another_users_task_returns_404_not_403(self):
        owner, owner_client = auth_client("owner@example.com")
        other, other_client = auth_client("other@example.com")
        task_id = str(uuid.uuid4())
        owner_client.post("/api/tasks/", make_task_payload(id=task_id), format="json")

        get_response = other_client.get(f"/api/tasks/{task_id}/")
        put_response = other_client.put(
            f"/api/tasks/{task_id}/",
            make_task_payload(id=task_id, title="hijacked"),
            format="json",
        )
        delete_response = other_client.delete(f"/api/tasks/{task_id}/")

        self.assertEqual(get_response.status_code, 404)
        self.assertEqual(put_response.status_code, 404)
        self.assertEqual(delete_response.status_code, 404)
        self.assertEqual(Task.objects.get(id=task_id).title, "write plan")

    def test_create_rejects_a_repeat_source_that_does_not_exist(self):
        owner, client = auth_client()

        response = client.post(
            "/api/tasks/",
            make_task_payload(repeat_source=str(uuid.uuid4())),
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_create_rejects_a_repeat_source_belonging_to_another_user(self):
        owner, owner_client = auth_client("owner@example.com")
        other, other_client = auth_client("other@example.com")
        other_task_id = str(uuid.uuid4())
        other_client.post("/api/tasks/", make_task_payload(id=other_task_id), format="json")

        response = owner_client.post(
            "/api/tasks/",
            make_task_payload(repeat_source=other_task_id),
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_create_rejects_a_duplicate_id(self):
        owner, client = auth_client()
        task_id = str(uuid.uuid4())
        client.post("/api/tasks/", make_task_payload(id=task_id, title="first"), format="json")

        response = client.post(
            "/api/tasks/",
            make_task_payload(id=task_id, title="second"),
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Task.objects.get(id=task_id).title, "first")

    def test_put_cannot_reassign_id_to_hijack_another_users_task(self):
        owner, owner_client = auth_client("owner@example.com")
        other, other_client = auth_client("other@example.com")
        owner_task_id = str(uuid.uuid4())
        other_task_id = str(uuid.uuid4())
        owner_client.post(
            "/api/tasks/",
            make_task_payload(id=owner_task_id, title="owner's task"),
            format="json",
        )
        other_client.post(
            "/api/tasks/",
            make_task_payload(id=other_task_id, title="other's task"),
            format="json",
        )

        response = owner_client.put(
            f"/api/tasks/{owner_task_id}/",
            make_task_payload(id=other_task_id, title="hijacked"),
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        other_task = Task.objects.get(id=other_task_id)
        self.assertEqual(other_task.title, "other's task")
        self.assertEqual(other_task.user, other)
        owner_task = Task.objects.get(id=owner_task_id)
        self.assertEqual(owner_task.title, "hijacked")
        self.assertEqual(owner_task.user, owner)

    def test_update_omitting_optional_fields_clears_them_instead_of_preserving_them(self):
        owner, client = auth_client()
        task_id = str(uuid.uuid4())
        client.post(
            "/api/tasks/",
            make_task_payload(
                id=task_id,
                memo="keep me?",
                priority=True,
                subtasks=[{"id": "s1", "title": "x", "done": False}],
            ),
            format="json",
        )

        minimal_payload = {
            "id": task_id,
            "title": "replaced",
            "done": False,
            "scope_kind": "day",
            "scope_value": "2026-07-27",
            "created_at": "2026-07-27T00:00:00.000Z",
        }
        response = client.put(f"/api/tasks/{task_id}/", minimal_payload, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        stored = Task.objects.get(id=task_id)
        self.assertIsNone(stored.memo)
        self.assertIsNone(stored.priority)
        self.assertEqual(stored.subtasks, [])

    def test_create_rejects_non_array_subtasks_repeat_weekdays_and_excluded_dates(self):
        owner, client = auth_client()

        response = client.post(
            "/api/tasks/",
            make_task_payload(subtasks="nope", repeat_weekdays=5, excluded_dates="oops"),
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_list_is_ordered_by_created_at(self):
        owner, client = auth_client()
        client.post(
            "/api/tasks/",
            make_task_payload(id=str(uuid.uuid4()), title="second", created_at="2026-07-27T10:00:00.000Z"),
            format="json",
        )
        client.post(
            "/api/tasks/",
            make_task_payload(id=str(uuid.uuid4()), title="first", created_at="2026-07-27T09:00:00.000Z"),
            format="json",
        )

        response = client.get("/api/tasks/")

        self.assertEqual([t["title"] for t in response.data], ["first", "second"])

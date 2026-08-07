import importlib
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Category, Task, normalize_category_name
from .serializers import EXCLUDED_DATES_MAX_COUNT, SUBTASKS_MAX_COUNT
from .services import (
    delete_occurrence,
    detach_task,
    nest_task,
    promote_subtask,
    reschedule_task,
)


User = get_user_model()


def auth_client(email="owner@example.com", password="StrongPass123!"):
    # Authentication throttles deliberately persist outside database
    # transactions. Keep this unrelated task-test helper isolated from prior
    # tests while dedicated throttle tests exercise persistence explicitly.
    cache.clear()
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
        "bucket_category": None,
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


def if_match(version=1):
    return {"HTTP_IF_MATCH": f'"{version}"'}


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
            make_task_payload(
                id=anchor_id,
                title="anchor",
                repeat_weekdays=[1, 3, 5],
                excluded_dates=["2026-07-13"],
            ),
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
                time="09:30",
                subtasks=[{"id": "s1", "title": "buy wood", "done": False}],
                repeat_source=anchor_id,
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
        self.assertIsNotNone(stored.completed_at)
        self.assertLess(timezone.now() - stored.completed_at, timedelta(seconds=5))
        self.assertEqual(stored.time, "09:30")
        self.assertEqual(stored.subtasks, [{"id": "s1", "title": "buy wood", "done": False}])
        self.assertEqual(str(stored.repeat_source_id), anchor_id)
        self.assertTrue(stored.priority)
        self.assertEqual(stored.duration_minutes, 45)
        self.assertTrue(stored.background)
        self.assertEqual(Task.objects.get(id=anchor_id).excluded_dates, ["2026-07-13"])

        # due_date and repeat_weekdays/repeat_source are mutually exclusive
        # (RF-006 round 2, rule 7 — "unset for routine tasks"), so it can't
        # round-trip on either task above; prove it separately here on a
        # standalone, non-routine task.
        plain_id = str(uuid.uuid4())
        plain_response = client.post(
            "/api/tasks/",
            make_task_payload(id=plain_id, title="plain", due_date="2026-08-01"),
            format="json",
        )
        self.assertEqual(plain_response.status_code, 201, plain_response.data)
        self.assertEqual(Task.objects.get(id=plain_id).due_date, "2026-08-01")

    def test_create_truncates_subtask_fields_that_commands_cannot_store_safely(self):
        # RF-006 review finding: an outright 400 here means an unrelated
        # edit to a task carrying one legacy over-length subtask can never
        # be saved again (the generic PUT always resends the whole
        # subtasks array), and a legacy-localStorage task with one would
        # never clear the migration-upload retry loop. Truncating instead
        # of rejecting keeps the write-path limit (nothing this API stores
        # can later fail to materialize into a Task via Promote) without
        # permanently locking out old data — existing DB rows get the same
        # treatment once via migration 0014.
        owner, client = auth_client("subtask-limits@example.com")
        task_id = str(uuid.uuid4())

        response = client.post(
            "/api/tasks/",
            make_task_payload(
                id=task_id,
                subtasks=[
                    {"id": "a" * 300, "title": "valid", "done": False},
                    {"id": "valid-2", "title": "b" * 600, "done": False},
                ],
            ),
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        stored = Task.objects.get(id=task_id)
        self.assertEqual(len(stored.subtasks[0]["id"]), 255)
        self.assertEqual(stored.subtasks[0]["id"], "a" * 255)
        self.assertEqual(len(stored.subtasks[1]["title"]), 500)
        self.assertEqual(stored.subtasks[1]["title"], "b" * 500)

    def test_create_accepts_subtask_fields_at_exactly_the_length_boundary(self):
        owner, client = auth_client("subtask-limits-boundary@example.com")
        task_id = str(uuid.uuid4())

        response = client.post(
            "/api/tasks/",
            make_task_payload(
                id=task_id,
                subtasks=[{"id": "a" * 255, "title": "b" * 500, "done": False}],
            ),
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        stored = Task.objects.get(id=task_id)
        self.assertEqual(stored.subtasks[0]["id"], "a" * 255)
        self.assertEqual(stored.subtasks[0]["title"], "b" * 500)

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
            **if_match(),
        )

        self.assertEqual(response.status_code, 200, response.data)
        stored = Task.objects.get(id=task_id)
        self.assertEqual(stored.title, "after")
        self.assertIsNone(stored.priority)
        self.assertEqual(response.data["version"], 2)
        self.assertEqual(response["ETag"], '"2"')

    def test_task_detail_exposes_version_and_etag(self):
        owner, client = auth_client()
        task_id = str(uuid.uuid4())
        create_response = client.post(
            "/api/tasks/",
            make_task_payload(id=task_id),
            format="json",
        )

        detail_response = client.get(f"/api/tasks/{task_id}/")

        self.assertEqual(create_response.data["version"], 1)
        self.assertEqual(detail_response.data["version"], 1)
        self.assertEqual(detail_response["ETag"], '"1"')

    def test_update_requires_one_quoted_if_match_version(self):
        owner, client = auth_client()
        task_id = str(uuid.uuid4())
        client.post("/api/tasks/", make_task_payload(id=task_id), format="json")

        missing = client.patch(f"/api/tasks/{task_id}/", {"memo": "x"}, format="json")
        malformed = client.patch(
            f"/api/tasks/{task_id}/",
            {"memo": "x"},
            format="json",
            HTTP_IF_MATCH="1",
        )

        self.assertEqual(missing.status_code, 428)
        self.assertEqual(missing.data["code"], "task_version_required")
        self.assertEqual(malformed.status_code, 400)
        self.assertEqual(malformed.data["code"], "task_version_malformed")
        self.assertIsNone(Task.objects.get(id=task_id).memo)

    def test_stale_put_cannot_overwrite_a_winning_update(self):
        owner, client = auth_client()
        task_id = str(uuid.uuid4())
        client.post(
            "/api/tasks/",
            make_task_payload(id=task_id, title="original"),
            format="json",
        )
        winner = client.patch(
            f"/api/tasks/{task_id}/",
            {"memo": "winner"},
            format="json",
            **if_match(1),
        )

        stale = client.put(
            f"/api/tasks/{task_id}/",
            make_task_payload(id=task_id, title="stale overwrite"),
            format="json",
            **if_match(1),
        )

        self.assertEqual(winner.status_code, 200)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.data["code"], "task_version_conflict")
        self.assertEqual(stale.data["current_versions"][task_id], 2)
        stored = Task.objects.get(id=task_id)
        self.assertEqual(stored.title, "original")
        self.assertEqual(stored.memo, "winner")
        self.assertEqual(stored.version, 2)

    def test_stale_delete_is_rejected_without_removing_the_task(self):
        owner, client = auth_client()
        task_id = str(uuid.uuid4())
        client.post("/api/tasks/", make_task_payload(id=task_id), format="json")
        client.patch(
            f"/api/tasks/{task_id}/",
            {"memo": "newer"},
            format="json",
            **if_match(1),
        )

        response = client.delete(f"/api/tasks/{task_id}/", **if_match(1))

        self.assertEqual(response.status_code, 409)
        self.assertTrue(Task.objects.filter(id=task_id).exists())

    def test_delete_removes_the_task(self):
        owner, client = auth_client()
        task_id = str(uuid.uuid4())
        client.post("/api/tasks/", make_task_payload(id=task_id), format="json")

        response = client.delete(f"/api/tasks/{task_id}/", **if_match())

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

        client.delete(f"/api/tasks/{anchor_id}/", **if_match())

        occurrence = Task.objects.get(id=occurrence_id)
        self.assertIsNone(occurrence.repeat_source_id)
        # RF-005 review finding: the SET_NULL cascade bypasses Task.save(),
        # so without an explicit bump a client holding the pre-detach
        # version could still pass If-Match after this occurrence's meaning
        # changed underneath it.
        self.assertEqual(occurrence.version, 2)

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
            **if_match(),
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
        response = client.put(
            f"/api/tasks/{task_id}/",
            minimal_payload,
            format="json",
            **if_match(),
        )

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
        first_id = str(uuid.uuid4())
        second_id = str(uuid.uuid4())
        client.post("/api/tasks/", make_task_payload(id=first_id, title="second"), format="json")
        client.post("/api/tasks/", make_task_payload(id=second_id, title="first"), format="json")

        # created_at is server-controlled now, so invert the stored order
        # directly at the DB level (bypassing the read-only serializer field)
        # to prove the list endpoint sorts by the created_at column itself,
        # not by request/insertion order.
        Task.objects.filter(id=first_id).update(
            created_at=datetime(2026, 7, 27, 10, 0, tzinfo=dt_timezone.utc)
        )
        Task.objects.filter(id=second_id).update(
            created_at=datetime(2026, 7, 27, 9, 0, tzinfo=dt_timezone.utc)
        )

        response = client.get("/api/tasks/")

        self.assertEqual([t["title"] for t in response.data], ["first", "second"])

    def test_create_rejects_values_that_violate_restored_field_constraints(self):
        owner, client = auth_client()

        self.assertEqual(
            client.post("/api/tasks/", make_task_payload(rolled_from_value="x" * 21), format="json").status_code,
            400,
        )
        self.assertEqual(
            client.post("/api/tasks/", make_task_payload(time="123456"), format="json").status_code,
            400,
        )
        self.assertEqual(
            client.post("/api/tasks/", make_task_payload(due_date="x" * 11), format="json").status_code,
            400,
        )
        self.assertEqual(
            client.post("/api/tasks/", make_task_payload(duration_minutes=-5), format="json").status_code,
            400,
        )

    def test_create_ignores_a_client_supplied_created_at(self):
        owner, client = auth_client()
        task_id = str(uuid.uuid4())
        before = timezone.now()

        response = client.post(
            "/api/tasks/",
            make_task_payload(id=task_id, created_at="2020-01-01T00:00:00.000Z"),
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        stored = Task.objects.get(id=task_id)
        self.assertGreaterEqual(stored.created_at, before)

    def test_patching_done_to_true_sets_completed_at(self):
        owner, client = auth_client()
        task_id = str(uuid.uuid4())
        client.post("/api/tasks/", make_task_payload(id=task_id, done=False), format="json")
        before = timezone.now()

        response = client.patch(
            f"/api/tasks/{task_id}/",
            {"done": True},
            format="json",
            **if_match(),
        )

        self.assertEqual(response.status_code, 200, response.data)
        stored = Task.objects.get(id=task_id)
        self.assertTrue(stored.done)
        self.assertIsNotNone(stored.completed_at)
        self.assertGreaterEqual(stored.completed_at, before)

    def test_patching_done_to_false_clears_completed_at(self):
        owner, client = auth_client()
        task_id = str(uuid.uuid4())
        client.post("/api/tasks/", make_task_payload(id=task_id, done=True), format="json")
        self.assertIsNotNone(Task.objects.get(id=task_id).completed_at)

        response = client.patch(
            f"/api/tasks/{task_id}/",
            {"done": False},
            format="json",
            **if_match(),
        )

        self.assertEqual(response.status_code, 200, response.data)
        stored = Task.objects.get(id=task_id)
        self.assertFalse(stored.done)
        self.assertIsNone(stored.completed_at)

    def test_patching_an_explicit_completed_at_is_silently_dropped_not_rejected(self):
        owner, client = auth_client()
        task_id = str(uuid.uuid4())
        client.post("/api/tasks/", make_task_payload(id=task_id, done=False), format="json")

        response = client.patch(
            f"/api/tasks/{task_id}/",
            {"completed_at": "2020-01-01T00:00:00.000Z"},
            format="json",
            **if_match(),
        )

        self.assertEqual(response.status_code, 200, response.data)
        stored = Task.objects.get(id=task_id)
        self.assertIsNone(stored.completed_at)

    def test_create_rejects_a_subtask_missing_a_required_key(self):
        owner, client = auth_client()

        response = client.post(
            "/api/tasks/",
            make_task_payload(subtasks=[{"id": "s1", "title": "x"}]),  # missing "done"
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_order_defaults_to_zero_and_is_updatable(self):
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/", make_task_payload(id=str(uuid.uuid4())), format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["order"], 0)

        task_id = response.data["id"]
        response = client.put(
            f"/api/tasks/{task_id}/",
            make_task_payload(id=task_id, order=2.5),
            format="json",
            **if_match(),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["order"], 2.5)


class TaskDomainValidationTests(TestCase):
    # RF-006 round 2: cross-field scope, bucket/category, rolled-from,
    # repeat, time/date, uniqueness, and bounded-collection rules on top of
    # the plain field-shape validation TaskApiTests already covers. Each
    # rule below gets an accept case and a reject case, matching the ground
    # truth derived from frontend/src/features/tasks/types.ts and
    # frontend/src/features/tasks/api/mapping.ts.

    # Rule 1: scope_value format must match scope_kind.
    def test_create_accepts_scope_value_formats_matching_each_scope_kind(self):
        owner, client = auth_client()
        cases = [("day", "2026-07-27"), ("week", "2026-07-27"), ("month", "2026-07"), ("year", "2026")]
        for kind, value in cases:
            with self.subTest(kind=kind):
                response = client.post(
                    "/api/tasks/",
                    make_task_payload(id=str(uuid.uuid4()), scope_kind=kind, scope_value=value),
                    format="json",
                )
                self.assertEqual(response.status_code, 201, response.data)

    def test_create_rejects_a_scope_value_that_does_not_match_its_scope_kinds_format(self):
        owner, client = auth_client()
        cases = [("day", "2026/07/27"), ("week", "07-27-2026"), ("month", "2026-07-27"), ("year", "26")]
        for kind, value in cases:
            with self.subTest(kind=kind):
                response = client.post(
                    "/api/tasks/",
                    make_task_payload(id=str(uuid.uuid4()), scope_kind=kind, scope_value=value),
                    format="json",
                )
                self.assertEqual(response.status_code, 400)

    def test_create_accepts_a_bucket_scoped_task_with_an_empty_scope_value(self):
        owner, client = auth_client()
        category = Category.objects.create(user=owner, name="Someday")
        response = client.post(
            "/api/tasks/",
            make_task_payload(scope_kind="bucket", scope_value="", bucket_category=str(category.id)),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_create_rejects_a_bucket_scoped_task_with_a_non_empty_scope_value(self):
        owner, client = auth_client()
        category = Category.objects.create(user=owner, name="Someday")
        response = client.post(
            "/api/tasks/",
            make_task_payload(
                scope_kind="bucket", scope_value="2026-07-27", bucket_category=str(category.id),
            ),
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    # Rule 2: bucket_category <-> scope_kind pairing.
    def test_create_accepts_a_bucket_scoped_task_with_bucket_category_set(self):
        owner, client = auth_client()
        category = Category.objects.create(user=owner, name="Someday")
        response = client.post(
            "/api/tasks/",
            make_task_payload(scope_kind="bucket", scope_value="", bucket_category=str(category.id)),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_create_rejects_bucket_category_scope_kind_mismatches(self):
        owner, client = auth_client()
        category = Category.objects.create(user=owner, name="Someday")
        cases = {
            "bucket_without_category": {"scope_kind": "bucket", "scope_value": ""},
            "non_bucket_with_category": {"bucket_category": str(category.id)},
        }
        for label, overrides in cases.items():
            with self.subTest(label=label):
                response = client.post(
                    "/api/tasks/",
                    make_task_payload(id=str(uuid.uuid4()), **overrides),
                    format="json",
                )
                self.assertEqual(response.status_code, 400)

    # Rule 3: rolled_from_kind/rolled_from_value pairing, format, and the
    # "bucket" rejection judgment call.
    def test_create_accepts_a_task_with_matching_rolled_from_kind_and_value(self):
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/",
            make_task_payload(rolled_from_kind="day", rolled_from_value="2026-07-20"),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_create_rejects_a_rolled_from_kind_set_without_a_rolled_from_value(self):
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/",
            make_task_payload(rolled_from_kind="day", rolled_from_value=None),
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_create_rejects_a_rolled_from_value_whose_format_does_not_match_its_kind(self):
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/",
            make_task_payload(rolled_from_kind="month", rolled_from_value="2026-07-20"),
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_create_rejects_a_bucket_rolled_from_kind_as_an_invalid_domain_state(self):
        # Judgment call (see PR description): mapping.ts documents that
        # rolled_from_kind="bucket" is type-legal but never produced by this
        # app, since nothing rolls a bucket-scoped task over.
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/",
            make_task_payload(rolled_from_kind="bucket", rolled_from_value="not-empty"),
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    # Rule 4: repeat_weekdays / repeat_source are mutually exclusive.
    def test_create_accepts_a_task_with_only_repeat_weekdays_set(self):
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/", make_task_payload(repeat_weekdays=[1, 3]), format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_create_rejects_a_task_with_both_repeat_weekdays_and_repeat_source_set(self):
        owner, client = auth_client()
        anchor_id = str(uuid.uuid4())
        client.post("/api/tasks/", make_task_payload(id=anchor_id, repeat_weekdays=[1]), format="json")

        response = client.post(
            "/api/tasks/",
            make_task_payload(repeat_weekdays=[2], repeat_source=anchor_id),
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    # Rule 5: repeat_weekdays must be a non-empty list of unique weekdays
    # when present.
    def test_create_accepts_repeat_weekdays_with_unique_values(self):
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/", make_task_payload(repeat_weekdays=[0, 6]), format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_create_rejects_repeat_weekdays_with_a_duplicate_value(self):
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/", make_task_payload(repeat_weekdays=[1, 1]), format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_create_rejects_an_empty_repeat_weekdays_list(self):
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/", make_task_payload(repeat_weekdays=[]), format="json",
        )
        self.assertEqual(response.status_code, 400)

    # Rule 6: excluded_dates requires an anchor (repeat_weekdays).
    def test_create_accepts_excluded_dates_on_an_anchor_task(self):
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/",
            make_task_payload(repeat_weekdays=[1], excluded_dates=["2026-07-13"]),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_create_rejects_excluded_dates_without_repeat_weekdays(self):
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/", make_task_payload(excluded_dates=["2026-07-13"]), format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_create_rejects_a_malformed_or_duplicate_excluded_dates_entry(self):
        owner, client = auth_client()
        cases = {"malformed": ["07-13-2026"], "duplicate": ["2026-07-13", "2026-07-13"]}
        for label, excluded_dates in cases.items():
            with self.subTest(label=label):
                response = client.post(
                    "/api/tasks/",
                    make_task_payload(
                        id=str(uuid.uuid4()), repeat_weekdays=[1], excluded_dates=excluded_dates,
                    ),
                    format="json",
                )
                self.assertEqual(response.status_code, 400)

    # Rule 7: due_date is excluded for routine-managed tasks.
    def test_create_accepts_a_due_date_on_a_non_routine_task(self):
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/", make_task_payload(due_date="2026-08-01"), format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_create_rejects_a_due_date_on_an_anchor_task(self):
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/",
            make_task_payload(repeat_weekdays=[1], due_date="2026-08-01"),
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_create_rejects_a_due_date_on_an_occurrence_task(self):
        owner, client = auth_client()
        anchor_id = str(uuid.uuid4())
        client.post("/api/tasks/", make_task_payload(id=anchor_id, repeat_weekdays=[1]), format="json")

        response = client.post(
            "/api/tasks/",
            make_task_payload(repeat_source=anchor_id, due_date="2026-08-01"),
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_create_rejects_a_due_date_with_the_wrong_format(self):
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/", make_task_payload(due_date="08/01/2026"), format="json",
        )
        self.assertEqual(response.status_code, 400)

    # Rule 8: duration_minutes requires time; time's own "HH:MM" format.
    def test_create_accepts_duration_minutes_alongside_time(self):
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/", make_task_payload(time="09:30", duration_minutes=45), format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_create_rejects_duration_minutes_without_time(self):
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/", make_task_payload(duration_minutes=45), format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_create_accepts_a_well_formed_time_value(self):
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/", make_task_payload(time="00:00"), format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_create_rejects_a_malformed_time_value(self):
        owner, client = auth_client()
        for value in ["9:30", "24:00", "09:60", "09-30"]:
            with self.subTest(value=value):
                response = client.post(
                    "/api/tasks/", make_task_payload(id=str(uuid.uuid4()), time=value), format="json",
                )
                self.assertEqual(response.status_code, 400)

    # Rule 9: subtask ids must be unique within a task.
    def test_create_accepts_subtasks_with_unique_ids(self):
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/",
            make_task_payload(
                subtasks=[
                    {"id": "s1", "title": "one", "done": False},
                    {"id": "s2", "title": "two", "done": False},
                ],
            ),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_create_rejects_subtasks_with_a_duplicate_id(self):
        owner, client = auth_client()
        response = client.post(
            "/api/tasks/",
            make_task_payload(
                subtasks=[
                    {"id": "s1", "title": "one", "done": False},
                    {"id": "s1", "title": "two", "done": False},
                ],
            ),
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    # Rule 10: bounded-collection defensive caps on subtasks/excluded_dates.
    def test_create_accepts_subtasks_at_the_defensive_cap(self):
        owner, client = auth_client()
        subtasks = [{"id": f"s{i}", "title": f"t{i}", "done": False} for i in range(SUBTASKS_MAX_COUNT)]
        response = client.post(
            "/api/tasks/", make_task_payload(subtasks=subtasks), format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_create_rejects_subtasks_beyond_the_defensive_cap(self):
        owner, client = auth_client()
        subtasks = [
            {"id": f"s{i}", "title": f"t{i}", "done": False} for i in range(SUBTASKS_MAX_COUNT + 1)
        ]
        response = client.post(
            "/api/tasks/", make_task_payload(subtasks=subtasks), format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_create_accepts_excluded_dates_at_the_defensive_cap(self):
        owner, client = auth_client()
        start = datetime(2026, 1, 1)
        excluded_dates = [
            (start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(EXCLUDED_DATES_MAX_COUNT)
        ]
        response = client.post(
            "/api/tasks/",
            make_task_payload(repeat_weekdays=[1], excluded_dates=excluded_dates),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_create_rejects_excluded_dates_beyond_the_defensive_cap(self):
        owner, client = auth_client()
        start = datetime(2026, 1, 1)
        excluded_dates = [
            (start + timedelta(days=i)).strftime("%Y-%m-%d")
            for i in range(EXCLUDED_DATES_MAX_COUNT + 1)
        ]
        response = client.post(
            "/api/tasks/",
            make_task_payload(repeat_weekdays=[1], excluded_dates=excluded_dates),
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    # A PATCH only carries the fields it sends, so validate() must merge
    # against the current instance rather than treat missing fields as
    # unset — otherwise a partial update could sneak past a cross-field
    # rule that a full create/PUT would have caught.
    def test_update_rejects_a_partial_patch_that_would_violate_a_cross_field_rule(self):
        owner, client = auth_client()
        task_id = str(uuid.uuid4())
        client.post("/api/tasks/", make_task_payload(id=task_id), format="json")

        response = client.patch(
            f"/api/tasks/{task_id}/",
            {"duration_minutes": 30},
            format="json",
            **if_match(),
        )

        self.assertEqual(response.status_code, 400)
        self.assertIsNone(Task.objects.get(id=task_id).duration_minutes)


class TaskCommandApiTests(TestCase):
    def setUp(self):
        self.user, self.client = auth_client("commands@example.com")

    def create_task(self, **overrides):
        task_id = overrides.pop("id", str(uuid.uuid4()))
        response = self.client.post(
            "/api/tasks/",
            make_task_payload(id=task_id, **overrides),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        return Task.objects.get(id=task_id)

    def nest(self, source, target, **overrides):
        payload = {
            "target_id": str(target.id),
            "source_version": source.version,
            "target_version": target.version,
            "subtask_id": str(uuid.uuid4()),
            "confirm_data_loss": False,
        }
        payload.update(overrides)
        return self.client.post(
            f"/api/tasks/{source.id}/commands/nest/",
            payload,
            format="json",
        )

    def promote(self, parent, subtask_id="s1", **overrides):
        payload = {
            "subtask_id": subtask_id,
            "parent_version": parent.version,
            "new_task_id": str(uuid.uuid4()),
        }
        payload.update(overrides)
        return self.client.post(
            f"/api/tasks/{parent.id}/commands/promote-subtask/",
            payload,
            format="json",
        )

    def detach(self, occurrence, **overrides):
        payload = {"occurrence_version": occurrence.version}
        payload.update(overrides)
        return self.client.post(
            f"/api/tasks/{occurrence.id}/commands/detach/",
            payload,
            format="json",
        )

    def delete_occurrence(self, occurrence, **overrides):
        payload = {"occurrence_version": occurrence.version}
        payload.update(overrides)
        return self.client.post(
            f"/api/tasks/{occurrence.id}/commands/delete-occurrence/",
            payload,
            format="json",
        )

    def reschedule(self, task, date, **overrides):
        payload = {"task_version": task.version, "date": date}
        payload.update(overrides)
        return self.client.post(
            f"/api/tasks/{task.id}/commands/reschedule/",
            payload,
            format="json",
        )

    def reorder(self, task, insert_before_id, **overrides):
        payload = {
            "task_version": task.version,
            "insert_before_id": insert_before_id,
        }
        payload.update(overrides)
        return self.client.post(
            f"/api/tasks/{task.id}/commands/reorder/",
            payload,
            format="json",
        )

    def test_nest_atomically_appends_subtask_and_removes_source(self):
        source = self.create_task(title="buy milk", done=True)
        target = self.create_task(
            title="groceries",
            subtasks=[{"id": "existing", "title": "bread", "done": False}],
        )

        response = self.nest(
            source,
            target,
            subtask_id="nested-1",
            confirm_data_loss=True,
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["removed_task_id"], str(source.id))
        self.assertFalse(Task.objects.filter(id=source.id).exists())
        target.refresh_from_db()
        self.assertEqual(target.version, 2)
        self.assertEqual(
            target.subtasks,
            [
                {"id": "existing", "title": "bread", "done": False},
                {"id": "nested-1", "title": "buy milk", "done": True},
            ],
        )
        self.assertEqual(response.data["target"]["version"], 2)

    def test_nest_allows_a_timed_target_in_the_same_daily_agenda(self):
        source = self.create_task(title="preparation")
        target = self.create_task(title="meeting", time="09:00")

        response = self.nest(source, target, subtask_id="timed-target-child")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(Task.objects.filter(id=source.id).exists())
        target.refresh_from_db()
        self.assertEqual(target.subtasks[0]["id"], "timed-target-child")

    def test_nest_rejects_nesting_a_task_into_itself(self):
        source = self.create_task(title="alone")

        response = self.nest(source, source)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "same_task")
        self.assertTrue(Task.objects.filter(id=source.id).exists())

    def test_nest_requires_explicit_confirmation_for_server_detected_data_loss(self):
        source = self.create_task(title="lossy", memo="important", priority=True)
        target = self.create_task(title="target")

        rejected = self.nest(source, target)
        accepted = self.nest(source, target, confirm_data_loss=True)

        self.assertEqual(rejected.status_code, 409)
        self.assertEqual(rejected.data["code"], "data_loss_confirmation_required")
        self.assertCountEqual(rejected.data["lost_fields"], ["memo", "priority"])
        self.assertEqual(accepted.status_code, 200, accepted.data)

    def test_nest_detects_data_loss_for_every_lossy_field_individually(self):
        # RF-005 review finding: the prior test only exercised memo and
        # priority, out of the fields _nest_data_loss_fields actually
        # checks. An incomplete check here means silent data loss, so each
        # field gets its own case.
        cases = [
            ({"done": True, "completed_at": timezone.now()}, "completed_at"),
            ({"time": "09:00"}, "time"),
            # RF-006 round 2, rule 8: duration_minutes requires time.
            ({"duration_minutes": 30, "time": "09:00"}, "duration_minutes"),
            ({"due_date": "2026-08-10"}, "due_date"),
            ({"background": True}, "background"),
            ({"rolled_from_kind": "day", "rolled_from_value": "2026-08-05"}, "rollover_history"),
        ]
        for overrides, expected_field in cases:
            with self.subTest(expected_field=expected_field):
                source = self.create_task(title=f"lossy-{expected_field}", **overrides)
                target = self.create_task(title=f"target-{expected_field}")

                response = self.nest(source, target)

                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.data["code"], "data_loss_confirmation_required")
                self.assertIn(expected_field, response.data["lost_fields"])

        # excluded_dates is only ever valid on a task that also has
        # repeat_weekdays set (RF-006 round 2, rule 6) — but a source with
        # repeat_weekdays is already rejected earlier in nest_task
        # ("source_is_repeating"), before the data-loss check ever runs, so
        # this combination can no longer be produced through the live API.
        # Write it directly against the DB, same as this suite's existing
        # legacy/pre-validation-data cases, to keep _nest_data_loss_fields's
        # excluded_dates handling covered.
        excluded_dates_source = self.create_task(title="lossy-excluded_dates")
        Task.objects.filter(id=excluded_dates_source.id).update(excluded_dates=["2026-08-05"])
        excluded_dates_source.refresh_from_db()
        excluded_dates_target = self.create_task(title="target-excluded_dates")

        response = self.nest(excluded_dates_source, excluded_dates_target)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "data_loss_confirmation_required")
        self.assertIn("excluded_dates", response.data["lost_fields"])

    def test_nest_revalidates_repeat_subtasks_and_duplicate_child_rules(self):
        target = self.create_task(
            title="target",
            subtasks=[{"id": "duplicate", "title": "existing", "done": False}],
        )
        repeating = self.create_task(title="routine", repeat_weekdays=[1])
        with_children = self.create_task(
            title="parent",
            subtasks=[{"id": "child", "title": "child", "done": False}],
        )

        cases = [
            (repeating, {}, "source_is_repeating"),
            (with_children, {}, "source_has_subtasks"),
            (self.create_task(title="duplicate id"), {"subtask_id": "duplicate"}, "duplicate_subtask_id"),
        ]
        for source, overrides, expected_code in cases:
            with self.subTest(expected_code=expected_code):
                response = self.nest(source, target, **overrides)
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.data["code"], expected_code)
                self.assertTrue(Task.objects.filter(id=source.id).exists())

    def test_nest_supports_bucket_tasks_for_promote_undo(self):
        category = Category.objects.create(user=self.user, name="Someday")
        source = self.create_task(
            title="promoted child",
            scope_kind="bucket",
            scope_value="",
            bucket_category=str(category.id),
        )
        target = self.create_task(
            title="bucket parent",
            scope_kind="bucket",
            scope_value="",
            bucket_category=str(category.id),
        )

        response = self.nest(source, target, subtask_id="undo-child")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(Task.objects.filter(id=source.id).exists())
        target.refresh_from_db()
        self.assertEqual(target.subtasks[0]["id"], "undo-child")

    def test_nest_blocks_a_former_anchor_that_still_has_occurrences(self):
        source = self.create_task(title="former anchor")
        occurrence = self.create_task(title="occurrence", repeat_source=str(source.id))
        target = self.create_task(title="target")

        response = self.nest(source, target)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "source_has_occurrences")
        self.assertTrue(Task.objects.filter(id=occurrence.id, repeat_source=source).exists())

    def test_nest_returns_404_when_the_target_is_not_owned(self):
        source = self.create_task(title="source")
        other = User.objects.create_user(username="other-command@example.com", email="other-command@example.com")
        target = Task.objects.create(
            id=uuid.uuid4(),
            user=other,
            title="other target",
            scope_kind="day",
            scope_value="2026-07-27",
        )

        response = self.nest(source, target)

        self.assertEqual(response.status_code, 404)
        self.assertTrue(Task.objects.filter(id=source.id).exists())
        self.assertEqual(Task.objects.get(id=target.id).subtasks, [])

    def test_nest_returns_404_when_the_source_is_not_owned(self):
        target = self.create_task(title="own target")
        other = User.objects.create_user(
            username="other-source@example.com",
            email="other-source@example.com",
        )
        source = Task.objects.create(
            id=uuid.uuid4(),
            user=other,
            title="other source",
            scope_kind="day",
            scope_value="2026-07-27",
        )

        response = self.nest(source, target)

        self.assertEqual(response.status_code, 404)
        self.assertTrue(Task.objects.filter(id=source.id).exists())
        target.refresh_from_db()
        self.assertEqual(target.subtasks, [])

    def test_nest_returns_404_when_source_or_target_is_missing(self):
        source = self.create_task(title="source")
        target = self.create_task(title="target")

        missing_source = self.client.post(
            f"/api/tasks/{uuid.uuid4()}/commands/nest/",
            {
                "target_id": str(target.id),
                "source_version": 1,
                "target_version": 1,
                "subtask_id": "missing-source-child",
            },
            format="json",
        )
        missing_target = self.nest(source, target, target_id=str(uuid.uuid4()))

        self.assertEqual(missing_source.status_code, 404)
        self.assertEqual(missing_target.status_code, 404)
        self.assertTrue(Task.objects.filter(id=source.id).exists())
        target.refresh_from_db()
        self.assertEqual(target.subtasks, [])

    def test_stale_nest_versions_make_no_changes(self):
        for stale_side in ("source", "target"):
            with self.subTest(stale_side=stale_side):
                source = self.create_task(title=f"source-{stale_side}")
                target = self.create_task(title=f"target-{stale_side}")
                stale_task = source if stale_side == "source" else target
                Task.objects.filter(id=stale_task.id).update(version=2)

                response = self.nest(
                    source,
                    target,
                    source_version=1,
                    target_version=1,
                )

                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.data["code"], "task_version_conflict")
                self.assertTrue(Task.objects.filter(id=source.id).exists())
                self.assertEqual(Task.objects.get(id=target.id).subtasks, [])

    def test_nest_rolls_back_target_when_source_delete_fails(self):
        source = self.create_task(title="source")
        target = self.create_task(title="target")

        with patch.object(Task, "delete", side_effect=RuntimeError("delete failed")):
            with self.assertRaisesRegex(RuntimeError, "delete failed"):
                nest_task(
                    user=self.user,
                    source_id=source.id,
                    target_id=target.id,
                    source_version=1,
                    target_version=1,
                    subtask_id="rollback-child",
                    confirm_data_loss=False,
                )

        self.assertTrue(Task.objects.filter(id=source.id).exists())
        target.refresh_from_db()
        self.assertEqual(target.subtasks, [])
        self.assertEqual(target.version, 1)

    def test_stale_put_after_nest_cannot_restore_old_target_subtasks(self):
        source = self.create_task(title="source")
        target = self.create_task(title="target")
        response = self.nest(source, target, subtask_id="kept-child")
        self.assertEqual(response.status_code, 200)

        stale = self.client.put(
            f"/api/tasks/{target.id}/",
            make_task_payload(id=str(target.id), title="stale target", subtasks=[]),
            format="json",
            **if_match(1),
        )

        self.assertEqual(stale.status_code, 409)
        self.assertEqual(Task.objects.get(id=target.id).subtasks[0]["id"], "kept-child")

    def test_promote_creates_one_task_and_updates_parent_atomically(self):
        parent = self.create_task(
            title="plan trip",
            order=1,
            subtasks=[{"id": "s1", "title": "book flights", "done": True}],
        )
        self.create_task(title="next sibling", order=2)
        new_task_id = str(uuid.uuid4())

        response = self.promote(parent, new_task_id=new_task_id)

        self.assertEqual(response.status_code, 201, response.data)
        parent.refresh_from_db()
        created = Task.objects.get(id=new_task_id)
        self.assertEqual(parent.subtasks, [])
        self.assertEqual(parent.version, 2)
        self.assertEqual(created.title, "book flights")
        self.assertTrue(created.done)
        self.assertIsNotNone(created.completed_at)
        self.assertGreater(created.order, 1)
        self.assertLess(created.order, 2)
        self.assertEqual(response.data["parent"]["version"], 2)
        self.assertEqual(response.data["task"]["version"], 1)

    def test_promote_rejects_an_overlength_legacy_subtask_title_without_partial_write(self):
        parent = self.create_task(title="legacy parent")
        legacy_subtasks = [{"id": "legacy", "title": "x" * 501, "done": False}]
        Task.objects.filter(pk=parent.pk).update(subtasks=legacy_subtasks)
        parent.refresh_from_db()

        response = self.promote(parent, subtask_id="legacy")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "invalid_subtask_title")
        parent.refresh_from_db()
        self.assertEqual(len(parent.subtasks[0]["title"]), 501)
        self.assertEqual(Task.objects.filter(user=parent.user).count(), 1)

    def test_promote_uses_timed_append_and_copies_bucket_category(self):
        timed_parent = self.create_task(
            title="meeting",
            time="09:00",
            subtasks=[{"id": "timed-child", "title": "prep", "done": False}],
        )
        self.create_task(title="all day", order=3)
        timed_response = self.promote(timed_parent, subtask_id="timed-child")

        category = Category.objects.create(user=self.user, name="To Go")
        bucket_parent = self.create_task(
            title="bucket",
            scope_kind="bucket",
            scope_value="",
            bucket_category=str(category.id),
            subtasks=[{"id": "bucket-child", "title": "research", "done": False}],
        )
        bucket_response = self.promote(bucket_parent, subtask_id="bucket-child")

        self.assertEqual(timed_response.status_code, 201)
        self.assertEqual(timed_response.data["task"]["order"], 4)
        self.assertEqual(bucket_response.status_code, 201)
        self.assertEqual(bucket_response.data["task"]["bucket_category"], str(category.id))
        self.assertEqual(bucket_response.data["task"]["order"], 0)

    def test_promote_rejects_stale_parent_duplicate_child_and_new_id_collision(self):
        stale_parent = self.create_task(
            title="stale",
            subtasks=[{"id": "s1", "title": "child", "done": False}],
        )
        Task.objects.filter(id=stale_parent.id).update(version=2)
        stale = self.promote(stale_parent, parent_version=1)

        # RF-006 round 2, rule 9 now rejects a subtasks array with a
        # duplicate id on create/update, so this legacy shape (which
        # promote_subtask's own len(matches) > 1 guard exists to handle)
        # can no longer arise through the live API — write it directly
        # against the DB instead, same as this suite's other
        # legacy/pre-validation-data cases.
        duplicate_parent = self.create_task(title="duplicates")
        Task.objects.filter(id=duplicate_parent.id).update(
            subtasks=[
                {"id": "dup", "title": "one", "done": False},
                {"id": "dup", "title": "two", "done": False},
            ]
        )
        duplicate_parent.refresh_from_db()
        duplicate = self.promote(duplicate_parent, subtask_id="dup")

        collision_parent = self.create_task(
            title="collision",
            subtasks=[{"id": "s1", "title": "child", "done": False}],
        )
        existing = self.create_task(title="existing id")
        collision = self.promote(collision_parent, new_task_id=str(existing.id))

        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.data["code"], "task_version_conflict")
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(duplicate.data["code"], "duplicate_subtask_id")
        self.assertEqual(collision.status_code, 409)
        self.assertEqual(collision.data["code"], "task_id_conflict")
        collision_parent.refresh_from_db()
        self.assertEqual(len(collision_parent.subtasks), 1)

    def test_detach_clears_repeat_source_and_excludes_the_date_on_the_anchor(self):
        anchor = self.create_task(
            title="gym", scope_value="2026-07-01", repeat_weekdays=[4],
        )
        occurrence = self.create_task(
            title="gym", scope_value="2026-07-16", repeat_source=str(anchor.id),
        )

        response = self.detach(occurrence)

        self.assertEqual(response.status_code, 200, response.data)
        occurrence.refresh_from_db()
        self.assertIsNone(occurrence.repeat_source_id)
        self.assertIsNone(occurrence.repeat_weekdays)
        self.assertEqual(occurrence.version, 2)
        anchor.refresh_from_db()
        self.assertEqual(anchor.excluded_dates, ["2026-07-16"])
        self.assertEqual(anchor.version, 2)
        self.assertEqual(response.data["occurrence"]["version"], 2)
        self.assertEqual(response.data["anchor"]["version"], 2)

    def test_detach_appends_to_existing_excluded_dates_rather_than_replacing_them(self):
        anchor = self.create_task(
            title="gym", scope_value="2026-07-01", repeat_weekdays=[4],
            excluded_dates=["2026-07-09"],
        )
        occurrence = self.create_task(
            title="gym", scope_value="2026-07-16", repeat_source=str(anchor.id),
        )

        self.detach(occurrence)

        anchor.refresh_from_db()
        self.assertEqual(anchor.excluded_dates, ["2026-07-09", "2026-07-16"])

    def test_detach_can_immediately_establish_a_new_repeat_schedule(self):
        occurrence = self.create_task(title="solo")

        response = self.detach(occurrence, repeat_weekdays=[2, 4])

        self.assertEqual(response.status_code, 200, response.data)
        occurrence.refresh_from_db()
        self.assertEqual(occurrence.repeat_weekdays, [2, 4])

    def test_detach_on_an_already_standalone_task_touches_no_anchor(self):
        response = self.detach(self.create_task(title="solo"))

        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn("anchor", response.data)

    def test_detach_returns_409_for_a_stale_version(self):
        occurrence = self.create_task(title="solo")

        response = self.detach(occurrence, occurrence_version=occurrence.version + 1)

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "task_version_conflict")

    def test_detach_returns_404_for_a_missing_or_unowned_occurrence(self):
        response = self.client.post(
            f"/api/tasks/{uuid.uuid4()}/commands/detach/",
            {"occurrence_version": 1},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

        other_user, other_client = auth_client("detach-other@example.com")
        other_task = Task.objects.create(
            id=uuid.uuid4(), user=other_user, title="not yours",
            scope_kind="day", scope_value="2026-07-16",
        )
        response = self.detach(other_task)
        self.assertEqual(response.status_code, 404)

    def test_detach_rolls_back_anchor_exclusion_when_occurrence_save_fails(self):
        anchor = self.create_task(
            title="gym", scope_value="2026-07-01", repeat_weekdays=[4],
        )
        occurrence = self.create_task(
            title="gym", scope_value="2026-07-16", repeat_source=str(anchor.id),
        )
        original_save = Task.save

        def fail_occurrence_save(instance, *args, **kwargs):
            if instance.id == occurrence.id:
                raise RuntimeError("occurrence save failed")
            return original_save(instance, *args, **kwargs)

        with patch.object(Task, "save", autospec=True, side_effect=fail_occurrence_save):
            with self.assertRaisesRegex(RuntimeError, "occurrence save failed"):
                detach_task(
                    user=self.user,
                    occurrence_id=occurrence.id,
                    occurrence_version=occurrence.version,
                    repeat_weekdays=None,
                )

        occurrence.refresh_from_db()
        self.assertEqual(occurrence.repeat_source_id, anchor.id)
        self.assertEqual(occurrence.version, 1)
        anchor.refresh_from_db()
        self.assertIsNone(anchor.excluded_dates)
        self.assertEqual(anchor.version, 1)

    def test_delete_occurrence_removes_the_task_and_excludes_its_date_on_the_anchor(self):
        anchor = self.create_task(
            title="gym", scope_value="2026-07-01", repeat_weekdays=[4],
        )
        occurrence = self.create_task(
            title="gym", scope_value="2026-07-16", repeat_source=str(anchor.id),
        )

        response = self.delete_occurrence(occurrence)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["removed_task_id"], str(occurrence.id))
        self.assertFalse(Task.objects.filter(id=occurrence.id).exists())
        anchor.refresh_from_db()
        self.assertEqual(anchor.excluded_dates, ["2026-07-16"])

    def test_delete_occurrence_on_a_standalone_task_touches_no_anchor(self):
        response = self.delete_occurrence(self.create_task(title="solo"))

        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn("anchor", response.data)
        self.assertFalse(Task.objects.filter(title="solo").exists())

    def test_delete_occurrence_returns_409_for_a_stale_version(self):
        occurrence = self.create_task(title="solo")

        response = self.delete_occurrence(occurrence, occurrence_version=occurrence.version + 1)

        self.assertEqual(response.status_code, 409, response.data)
        self.assertTrue(Task.objects.filter(id=occurrence.id).exists())

    def test_delete_occurrence_returns_404_for_a_missing_or_unowned_occurrence(self):
        response = self.client.post(
            f"/api/tasks/{uuid.uuid4()}/commands/delete-occurrence/",
            {"occurrence_version": 1},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

        other_user, other_client = auth_client("delete-occ-other@example.com")
        other_task = Task.objects.create(
            id=uuid.uuid4(), user=other_user, title="not yours",
            scope_kind="day", scope_value="2026-07-16",
        )
        response = self.delete_occurrence(other_task)
        self.assertEqual(response.status_code, 404)
        self.assertTrue(Task.objects.filter(id=other_task.id).exists())

    def test_delete_occurrence_rolls_back_anchor_exclusion_when_occurrence_delete_fails(self):
        anchor = self.create_task(
            title="gym", scope_value="2026-07-01", repeat_weekdays=[4],
        )
        occurrence = self.create_task(
            title="gym", scope_value="2026-07-16", repeat_source=str(anchor.id),
        )

        with patch.object(Task, "delete", side_effect=RuntimeError("delete failed")):
            with self.assertRaisesRegex(RuntimeError, "delete failed"):
                delete_occurrence(
                    user=self.user,
                    occurrence_id=occurrence.id,
                    occurrence_version=occurrence.version,
                )

        self.assertTrue(Task.objects.filter(id=occurrence.id).exists())
        anchor.refresh_from_db()
        self.assertIsNone(anchor.excluded_dates)
        self.assertEqual(anchor.version, 1)

    def test_promote_returns_404_for_a_missing_or_unowned_parent(self):
        missing = self.client.post(
            f"/api/tasks/{uuid.uuid4()}/commands/promote-subtask/",
            {
                "subtask_id": "s1",
                "parent_version": 1,
                "new_task_id": str(uuid.uuid4()),
            },
            format="json",
        )
        other = User.objects.create_user(
            username="other-parent@example.com",
            email="other-parent@example.com",
        )
        other_parent = Task.objects.create(
            id=uuid.uuid4(),
            user=other,
            title="other parent",
            scope_kind="day",
            scope_value="2026-07-27",
            subtasks=[{"id": "s1", "title": "private", "done": False}],
        )

        unowned = self.promote(other_parent)

        self.assertEqual(missing.status_code, 404)
        self.assertEqual(unowned.status_code, 404)
        other_parent.refresh_from_db()
        self.assertEqual(len(other_parent.subtasks), 1)

    def test_promote_rejects_a_missing_subtask_without_creating_a_task(self):
        parent = self.create_task(
            title="parent",
            subtasks=[{"id": "s1", "title": "child", "done": False}],
        )
        new_task_id = uuid.uuid4()

        response = self.promote(
            parent,
            subtask_id="missing",
            new_task_id=str(new_task_id),
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "subtask_not_found")
        self.assertFalse(Task.objects.filter(id=new_task_id).exists())
        parent.refresh_from_db()
        self.assertEqual(len(parent.subtasks), 1)

    def test_task_commands_require_authentication(self):
        source = self.create_task(title="source")
        target = self.create_task(title="target")
        parent = self.create_task(
            title="parent",
            subtasks=[{"id": "s1", "title": "child", "done": False}],
        )
        anonymous = APIClient()

        nest_response = anonymous.post(
            f"/api/tasks/{source.id}/commands/nest/",
            {
                "target_id": str(target.id),
                "source_version": source.version,
                "target_version": target.version,
                "subtask_id": "anonymous-child",
            },
            format="json",
        )
        promote_response = anonymous.post(
            f"/api/tasks/{parent.id}/commands/promote-subtask/",
            {
                "subtask_id": "s1",
                "parent_version": parent.version,
                "new_task_id": str(uuid.uuid4()),
            },
            format="json",
        )

        self.assertEqual(nest_response.status_code, 401)
        self.assertEqual(promote_response.status_code, 401)

    def test_promote_rolls_back_created_task_when_parent_save_fails(self):
        parent = self.create_task(
            title="parent",
            subtasks=[{"id": "s1", "title": "child", "done": False}],
        )
        new_task_id = uuid.uuid4()
        original_save = Task.save

        def fail_parent_save(instance, *args, **kwargs):
            if instance.id == parent.id:
                raise RuntimeError("parent save failed")
            return original_save(instance, *args, **kwargs)

        with patch.object(Task, "save", autospec=True, side_effect=fail_parent_save):
            with self.assertRaisesRegex(RuntimeError, "parent save failed"):
                promote_subtask(
                    user=self.user,
                    parent_id=parent.id,
                    subtask_id="s1",
                    parent_version=1,
                    new_task_id=new_task_id,
                )

        self.assertFalse(Task.objects.filter(id=new_task_id).exists())
        parent.refresh_from_db()
        self.assertEqual(len(parent.subtasks), 1)
        self.assertEqual(parent.version, 1)

    def test_reschedule_moves_a_day_scoped_task_and_clears_repeat_source(self):
        anchor = self.create_task(
            title="gym", scope_value="2026-07-01", repeat_weekdays=[4],
        )
        occurrence = self.create_task(
            title="gym", scope_value="2026-07-16", repeat_source=str(anchor.id),
        )

        response = self.reschedule(occurrence, "2026-07-20")

        self.assertEqual(response.status_code, 200, response.data)
        occurrence.refresh_from_db()
        self.assertEqual(occurrence.scope_kind, "day")
        self.assertEqual(occurrence.scope_value, "2026-07-20")
        self.assertIsNone(occurrence.repeat_source_id)
        anchor.refresh_from_db()
        self.assertEqual(anchor.excluded_dates, ["2026-07-16"])

    def test_reschedule_moves_a_rolled_over_week_scoped_task_clearing_rolled_from(self):
        task = self.create_task(title="overdue thing", scope_kind="week")
        task.scope_kind = "week"
        task.scope_value = "2026-07-13"
        task.rolled_from_kind = "day"
        task.rolled_from_value = "2026-07-10"
        task.save(update_fields=["scope_kind", "scope_value", "rolled_from_kind", "rolled_from_value"])

        response = self.reschedule(task, "2026-07-20")

        self.assertEqual(response.status_code, 200, response.data)
        task.refresh_from_db()
        self.assertEqual(task.scope_kind, "day")
        self.assertEqual(task.scope_value, "2026-07-20")
        self.assertIsNone(task.rolled_from_kind)
        self.assertIsNone(task.rolled_from_value)

    def test_reschedule_appends_order_past_the_destinations_untimed_tasks(self):
        existing = self.create_task(title="already there", scope_value="2026-07-20", order=3)
        task = self.create_task(title="moving in", scope_value="2026-07-16")

        self.reschedule(task, "2026-07-20")

        task.refresh_from_db()
        self.assertEqual(task.order, 4.0)

    def test_reschedule_leaves_a_timed_tasks_order_untouched(self):
        task = self.create_task(title="timed", scope_value="2026-07-16", time="09:00", order=7)

        self.reschedule(task, "2026-07-20")

        task.refresh_from_db()
        self.assertEqual(task.order, 7)

    def test_reschedule_appends_order_accounting_for_rolled_over_week_scoped_siblings(self):
        # Test the week-scoped OR-branch of the order-calculation query: ensure
        # week-scoped tasks rolled over from the destination date are counted
        # when calculating the new order.
        rolled_sibling = self.create_task(title="rolled task", scope_kind="week", scope_value="2026-07-13")
        rolled_sibling.scope_kind = "week"
        rolled_sibling.scope_value = "2026-07-13"
        rolled_sibling.rolled_from_kind = "day"
        rolled_sibling.rolled_from_value = "2026-07-20"
        rolled_sibling.order = 5.0
        rolled_sibling.save(update_fields=["scope_kind", "scope_value", "rolled_from_kind", "rolled_from_value", "order"])

        task = self.create_task(title="moving in", scope_value="2026-07-16")

        self.reschedule(task, "2026-07-20")

        task.refresh_from_db()
        self.assertEqual(task.order, 6.0)

    def test_reschedule_rejects_the_same_effective_date_as_a_conflict(self):
        task = self.create_task(title="staying put", scope_value="2026-07-16")

        response = self.reschedule(task, "2026-07-16")

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "same_date")

    def test_reschedule_rejects_a_month_scoped_task_as_not_reschedulable(self):
        task = self.create_task(title="goal", scope_kind="month", scope_value="2026-07")

        response = self.reschedule(task, "2026-07-20")

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "not_reschedulable")

    def test_reschedule_returns_409_for_a_stale_version(self):
        task = self.create_task(title="solo", scope_value="2026-07-16")

        response = self.reschedule(task, "2026-07-20", task_version=task.version + 1)

        self.assertEqual(response.status_code, 409, response.data)

    def test_reschedule_returns_404_for_a_missing_or_unowned_task(self):
        response = self.client.post(
            f"/api/tasks/{uuid.uuid4()}/commands/reschedule/",
            {"task_version": 1, "date": "2026-07-20"},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_reschedule_rolls_back_anchor_exclusion_when_task_save_fails(self):
        anchor = self.create_task(
            title="gym", scope_value="2026-07-01", repeat_weekdays=[4],
        )
        occurrence = self.create_task(
            title="gym", scope_value="2026-07-16", repeat_source=str(anchor.id),
        )
        original_save = Task.save

        def fail_occurrence_save(instance, *args, **kwargs):
            if instance.id == occurrence.id:
                raise RuntimeError("reschedule save failed")
            return original_save(instance, *args, **kwargs)

        with patch.object(Task, "save", autospec=True, side_effect=fail_occurrence_save):
            with self.assertRaisesRegex(RuntimeError, "reschedule save failed"):
                reschedule_task(
                    user=self.user,
                    task_id=occurrence.id,
                    task_version=occurrence.version,
                    date="2026-07-20",
                )

        occurrence.refresh_from_db()
        self.assertEqual(occurrence.scope_value, "2026-07-16")
        self.assertIsNotNone(occurrence.repeat_source_id)
        self.assertEqual(occurrence.version, 1)
        anchor.refresh_from_db()
        self.assertIsNone(anchor.excluded_dates)
        self.assertEqual(anchor.version, 1)

    def test_reorder_moves_a_task_between_two_siblings(self):
        first = self.create_task(title="first", scope_value="2026-07-16", order=1.0)
        second = self.create_task(title="second", scope_value="2026-07-16", order=2.0)
        third = self.create_task(title="third", scope_value="2026-07-16", order=3.0)

        response = self.reorder(first, str(third.id))

        self.assertEqual(response.status_code, 200, response.data)
        first.refresh_from_db()
        self.assertEqual(first.order, 2.5)
        self.assertEqual(first.version, 2)
        self.assertEqual(response.data["task"]["order"], 2.5)

    def test_reorder_moves_a_task_to_the_end_with_a_null_insert_before_id(self):
        first = self.create_task(title="first", scope_value="2026-07-16", order=1.0)
        second = self.create_task(title="second", scope_value="2026-07-16", order=2.0)

        response = self.reorder(first, None)

        self.assertEqual(response.status_code, 200, response.data)
        first.refresh_from_db()
        self.assertEqual(first.order, 3.0)

    def test_reorder_inserting_before_the_first_sibling_uses_the_edge_gap(self):
        first = self.create_task(title="first", scope_value="2026-07-16", order=1.0)
        second = self.create_task(title="second", scope_value="2026-07-16", order=2.0)

        response = self.reorder(second, str(first.id))

        self.assertEqual(response.status_code, 200, response.data)
        second.refresh_from_db()
        self.assertEqual(second.order, 0.0)

    def test_reorder_counts_a_done_sibling_rolled_over_from_this_day(self):
        # Mirrors Weekly's rendering: a done, rolled-over week-scoped task is
        # still a real sibling that must count towards "the end of the list."
        rolled_over_done = self.create_task(
            title="done and rolled over",
            scope_kind="week",
            scope_value="2026-07-20",
            rolled_from_kind="day",
            rolled_from_value="2026-07-16",
            done=True,
            order=5.0,
        )
        moving = self.create_task(title="moving", scope_value="2026-07-16", order=1.0)

        response = self.reorder(moving, None)

        self.assertEqual(response.status_code, 200, response.data)
        moving.refresh_from_db()
        self.assertEqual(moving.order, 6.0)

    def test_reorder_rejects_a_timed_task_as_not_reorderable(self):
        timed = self.create_task(title="timed", scope_value="2026-07-16", time="09:00")

        response = self.reorder(timed, None)

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "not_reorderable")

    def test_reorder_rejects_a_month_scoped_task_as_not_reorderable(self):
        goal = self.create_task(title="goal", scope_kind="month", scope_value="2026-07")

        response = self.reorder(goal, None)

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "not_reorderable")

    def test_reorder_rejects_a_nonexistent_neighbor_as_invalid(self):
        task = self.create_task(title="alone", scope_value="2026-07-16")

        response = self.reorder(task, str(uuid.uuid4()))

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "invalid_neighbor")

    def test_reorder_rejects_a_neighbor_on_a_different_day_as_invalid(self):
        task = self.create_task(title="here", scope_value="2026-07-16")
        elsewhere = self.create_task(title="elsewhere", scope_value="2026-07-17")

        response = self.reorder(task, str(elsewhere.id))

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "invalid_neighbor")

    def test_reorder_rejects_a_timed_task_as_an_invalid_neighbor(self):
        task = self.create_task(title="here", scope_value="2026-07-16")
        timed_sibling = self.create_task(title="timed sibling", scope_value="2026-07-16", time="10:00")

        response = self.reorder(task, str(timed_sibling.id))

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "invalid_neighbor")

    def test_reorder_rejects_a_cross_owner_neighbor_as_invalid(self):
        task = self.create_task(title="here", scope_value="2026-07-16")
        other_user, other_client = auth_client("reorder-other@example.com")
        other_task = Task.objects.create(
            id=uuid.uuid4(), user=other_user, title="not yours",
            scope_kind="day", scope_value="2026-07-16",
        )

        response = self.reorder(task, str(other_task.id))

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "invalid_neighbor")

    def test_reorder_rejects_the_tasks_own_id_as_an_invalid_neighbor(self):
        task = self.create_task(title="here", scope_value="2026-07-16")

        response = self.reorder(task, str(task.id))

        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data["code"], "invalid_neighbor")

    def test_reorder_returns_409_for_a_stale_version(self):
        task = self.create_task(title="here", scope_value="2026-07-16")

        response = self.reorder(task, None, task_version=task.version + 1)

        self.assertEqual(response.status_code, 409, response.data)

    def test_reorder_returns_404_for_a_missing_or_unowned_task(self):
        response = self.client.post(
            f"/api/tasks/{uuid.uuid4()}/commands/reorder/",
            {"task_version": 1, "insert_before_id": None},
            format="json",
        )
        self.assertEqual(response.status_code, 404)


class BucketScopeTests(TestCase):
    def test_creates_and_fetches_a_bucket_scoped_task(self):
        owner, client = auth_client("bucket@example.com")
        category = Category.objects.create(user=owner, name="To Eat")
        payload = make_task_payload(scope_kind="bucket", scope_value="", bucket_category=str(category.id))
        response = client.post("/api/tasks/", payload, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["scope_kind"], "bucket")
        self.assertEqual(response.data["bucket_category"], str(category.id))

        get_response = client.get("/api/tasks/")
        self.assertEqual(get_response.data[0]["bucket_category"], str(category.id))

    def test_updates_a_task_from_one_category_to_another(self):
        owner, client = auth_client("bucket-update@example.com")
        to_go = Category.objects.create(user=owner, name="To Go")
        to_eat = Category.objects.create(user=owner, name="To Eat")
        payload = make_task_payload(scope_kind="bucket", scope_value="", bucket_category=str(to_go.id))
        create_response = client.post("/api/tasks/", payload, format="json")
        task_id = create_response.data["id"]

        payload["bucket_category"] = str(to_eat.id)
        update_response = client.put(
            f"/api/tasks/{task_id}/",
            payload,
            format="json",
            **if_match(),
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.data["bucket_category"], str(to_eat.id))

    def test_rejects_a_bucket_category_belonging_to_another_user(self):
        owner, client = auth_client("bucket-owner@example.com")
        other, _ = auth_client("bucket-other@example.com")
        others_category = Category.objects.create(user=other, name="Not Yours")
        payload = make_task_payload(
            scope_kind="bucket", scope_value="", bucket_category=str(others_category.id),
        )
        response = client.post("/api/tasks/", payload, format="json")
        self.assertEqual(response.status_code, 400)


class CategoryModelTests(TestCase):
    def test_normalizes_category_identity_with_nfkc_and_casefold(self):
        self.assertEqual(normalize_category_name("  Straße  "), "strasse")
        self.assertEqual(normalize_category_name("Ｔｏ Ｅａｔ"), "to eat")

    def test_two_users_can_each_have_a_category_with_the_same_name(self):
        owner, _ = auth_client("cat-owner@example.com")
        other, _ = auth_client("cat-other@example.com")
        Category.objects.create(user=owner, name="To Eat")
        Category.objects.create(user=other, name="To Eat")  # no IntegrityError

        self.assertEqual(Category.objects.filter(name="To Eat").count(), 2)

    def test_casefold_duplicate_name_for_the_same_user_is_rejected_at_the_db_level(self):
        from django.db import IntegrityError, transaction

        owner, _ = auth_client("cat-dupe@example.com")
        Category.objects.create(user=owner, name="Straße")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Category.objects.create(user=owner, name="STRASSE")

    def test_saving_a_renamed_category_updates_its_normalized_key(self):
        owner, _ = auth_client("cat-normalized-update@example.com")
        category = Category.objects.create(user=owner, name="To Eat")

        category.name = "  To Visit  "
        category.save(update_fields=["name"])
        category.refresh_from_db()

        self.assertEqual(category.name, "To Visit")
        self.assertEqual(category.normalized_name, "to visit")


import uuid as uuid_module

from django.contrib.auth import get_user_model as get_user_model_for_migration
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class BackfillBucketCategoriesMigrationTests(TransactionTestCase):
    def test_backfills_distinct_case_insensitive_categories_and_repoints_tasks(self):
        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0004_category_and_bucket_category_fk")])

        old_state = executor.loader.project_state(
            [("tasks", "0004_category_and_bucket_category_fk")]
        )
        OldUser = old_state.apps.get_model("auth", "User")
        OldTask = old_state.apps.get_model("tasks", "Task")

        user = OldUser.objects.create(username="migrate@example.com", email="migrate@example.com")
        other_user = OldUser.objects.create(username="migrate2@example.com", email="migrate2@example.com")

        # Same user, same category, two different castings — should dedupe
        # into ONE Category, keeping the earlier task's casing.
        OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="sushi", scope_kind="bucket",
            scope_value="To Eat", created_at="2026-07-01T00:00:00.000Z",
        )
        OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="ramen", scope_kind="bucket",
            scope_value="to eat", created_at="2026-07-02T00:00:00.000Z",
        )
        # A day-scoped task should be completely untouched by the migration.
        OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="unrelated", scope_kind="day",
            scope_value="2026-07-03", created_at="2026-07-03T00:00:00.000Z",
        )
        # A different user's bucket category with the SAME name as the first
        # user's — must become its own separate Category (per-user uniqueness).
        OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=other_user.id, title="also sushi", scope_kind="bucket",
            scope_value="To Eat", created_at="2026-07-01T00:00:00.000Z",
        )

        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0005_backfill_bucket_categories")])

        new_state = executor.loader.project_state(
            [("tasks", "0005_backfill_bucket_categories")]
        )
        NewCategory = new_state.apps.get_model("tasks", "Category")
        NewTask = new_state.apps.get_model("tasks", "Task")

        user_categories = NewCategory.objects.filter(user_id=user.id)
        self.assertEqual(user_categories.count(), 1)
        self.assertEqual(user_categories.first().name, "To Eat")  # earliest task's casing

        other_user_categories = NewCategory.objects.filter(user_id=other_user.id)
        self.assertEqual(other_user_categories.count(), 1)
        self.assertEqual(other_user_categories.first().id, other_user_categories.first().id)
        self.assertNotEqual(other_user_categories.first().id, user_categories.first().id)

        bucket_tasks = NewTask.objects.filter(user_id=user.id, scope_kind="bucket")
        self.assertEqual(bucket_tasks.count(), 2)
        for t in bucket_tasks:
            self.assertEqual(t.bucket_category_id, user_categories.first().id)

        untouched = NewTask.objects.get(user_id=user.id, scope_kind="day")
        self.assertIsNone(untouched.bucket_category_id)

        # Roll every app migration back to its latest state so later tests in
        # the suite (which use the real `apps.tasks.models.Task`/`Category`,
        # not this historical snapshot) run against the real schema.
        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", None)])
        call_command_migrate = __import__("django.core.management", fromlist=["call_command"]).call_command
        call_command_migrate("migrate")


class BackfillTaskOrderMigrationTests(TransactionTestCase):
    def test_backfills_order_from_created_at_sequence(self):
        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0005_backfill_bucket_categories")])

        old_state = executor.loader.project_state([("tasks", "0005_backfill_bucket_categories")])
        OldUser = old_state.apps.get_model("auth", "User")
        OldTask = old_state.apps.get_model("tasks", "Task")

        user = OldUser.objects.create(username="order@example.com", email="order@example.com")
        # Created out of created_at order, to prove the backfill sorts by
        # created_at rather than trusting row-insertion order.
        OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="third", scope_kind="day",
            scope_value="2026-07-03", created_at="2026-07-03T00:00:00.000Z",
        )
        OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="first", scope_kind="day",
            scope_value="2026-07-01", created_at="2026-07-01T00:00:00.000Z",
        )
        OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="second", scope_kind="day",
            scope_value="2026-07-02", created_at="2026-07-02T00:00:00.000Z",
        )

        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0006_task_order")])

        new_state = executor.loader.project_state([("tasks", "0006_task_order")])
        NewTask = new_state.apps.get_model("tasks", "Task")

        by_title = {t.title: t.order for t in NewTask.objects.filter(user_id=user.id)}
        self.assertLess(by_title["first"], by_title["second"])
        self.assertLess(by_title["second"], by_title["third"])

        # Roll every app migration back to its latest state so later tests in
        # the suite (which use the real `apps.tasks.models.Task`/`Category`,
        # not this historical snapshot) run against the real schema.
        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", None)])
        call_command_migrate = __import__("django.core.management", fromlist=["call_command"]).call_command
        call_command_migrate("migrate")


class BackfillTaskTimestampsMigrationTests(TransactionTestCase):
    def test_backfills_parsed_timestamps_and_falls_back_to_updated_at_on_bad_data(self):
        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0007_task_timestamps_shadow_fields")])

        old_state = executor.loader.project_state([("tasks", "0007_task_timestamps_shadow_fields")])
        OldUser = old_state.apps.get_model("auth", "User")
        OldTask = old_state.apps.get_model("tasks", "Task")

        user = OldUser.objects.create(username="ts@example.com", email="ts@example.com")

        valid = OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="valid", scope_kind="day",
            scope_value="2026-07-27", created_at="2026-07-27T09:00:00.000Z",
            completed_at="2026-07-27T10:00:00.000Z",
        )
        garbage_created = OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="garbage created", scope_kind="day",
            scope_value="2026-07-27", created_at="not-a-date",
        )
        empty_created = OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="empty created", scope_kind="day",
            scope_value="2026-07-27", created_at="",
        )
        garbage_completed = OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="garbage completed", scope_kind="day",
            scope_value="2026-07-27", created_at="2026-07-27T09:00:00.000Z",
            completed_at="also-not-a-date",
        )
        never_completed = OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="never completed", scope_kind="day",
            scope_value="2026-07-27", created_at="2026-07-27T09:00:00.000Z",
            completed_at=None,
        )
        out_of_range_created = OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="out of range created", scope_kind="day",
            scope_value="2026-07-27", created_at="2026-13-45T25:99:99",
        )
        out_of_range_completed = OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="out of range completed", scope_kind="day",
            scope_value="2026-07-27", created_at="2026-07-27T09:00:00.000Z",
            completed_at="2026-99-99T99:99:99",
        )

        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0009_task_timestamps_finalize")])

        new_state = executor.loader.project_state([("tasks", "0009_task_timestamps_finalize")])
        NewTask = new_state.apps.get_model("tasks", "Task")

        new_valid = NewTask.objects.get(id=valid.id)
        self.assertEqual(new_valid.created_at.isoformat(), "2026-07-27T09:00:00+00:00")
        self.assertEqual(new_valid.completed_at.isoformat(), "2026-07-27T10:00:00+00:00")

        new_garbage_created = NewTask.objects.get(id=garbage_created.id)
        self.assertEqual(new_garbage_created.created_at, new_garbage_created.updated_at)

        new_empty_created = NewTask.objects.get(id=empty_created.id)
        self.assertEqual(new_empty_created.created_at, new_empty_created.updated_at)

        new_garbage_completed = NewTask.objects.get(id=garbage_completed.id)
        self.assertEqual(new_garbage_completed.completed_at, new_garbage_completed.updated_at)

        new_never_completed = NewTask.objects.get(id=never_completed.id)
        self.assertIsNone(new_never_completed.completed_at)

        new_out_of_range_created = NewTask.objects.get(id=out_of_range_created.id)
        self.assertEqual(new_out_of_range_created.created_at, new_out_of_range_created.updated_at)

        new_out_of_range_completed = NewTask.objects.get(id=out_of_range_completed.id)
        self.assertEqual(new_out_of_range_completed.completed_at, new_out_of_range_completed.updated_at)

    def test_row_inserted_between_0008_and_0009_with_null_shadow_created_at_is_backfilled_not_fatal(self):
        # Simulates the deploy race: gunicorn restarts only after `migrate`
        # finishes, so the still-running old server process (which only
        # writes the string `created_at` column) can insert a new Task row
        # in the gap between 0008's backfill running and 0009 running. That
        # row's `created_at_dt` shadow column stays NULL. 0009 must
        # self-heal this defensively rather than hard-failing when it makes
        # `created_at` NOT NULL (and, on Oracle, doing so *after* the
        # RemoveField ops in the same migration have already auto-committed,
        # which would otherwise destroy the original string data).
        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0008_backfill_task_timestamps")])

        state_0008 = executor.loader.project_state([("tasks", "0008_backfill_task_timestamps")])
        OldUser = state_0008.apps.get_model("auth", "User")
        OldTask = state_0008.apps.get_model("tasks", "Task")

        user = OldUser.objects.create(username="race@example.com", email="race@example.com")
        # Insert directly into the shadow-column state the race would
        # produce: this row is created AFTER 0008's backfill already ran,
        # so nothing has populated created_at_dt/completed_at_dt for it.
        race_row = OldTask.objects.create(
            id=uuid_module.uuid4(), user_id=user.id, title="race row", scope_kind="day",
            scope_value="2026-07-27", created_at="2026-07-27T09:00:00.000Z",
            created_at_dt=None, completed_at_dt=None,
        )

        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0009_task_timestamps_finalize")])

        new_state = executor.loader.project_state([("tasks", "0009_task_timestamps_finalize")])
        NewTask = new_state.apps.get_model("tasks", "Task")

        new_race_row = NewTask.objects.get(id=race_row.id)
        self.assertIsNotNone(new_race_row.created_at)
        self.assertEqual(new_race_row.created_at, new_race_row.updated_at)


class CategoryNormalizedNameMigrationTests(TransactionTestCase):
    def test_backfill_preflight_rejects_a_normalized_key_that_exceeds_the_column(self):
        migration = importlib.import_module(
            "apps.tasks.migrations.0011_category_normalized_name_backfill"
        )
        category = SimpleNamespace(pk="expanding-category", name="\ufdfa" * 11)

        with self.assertRaisesMessage(RuntimeError, "198 characters"):
            migration.normalized_key(category)

    def test_merges_existing_casefold_duplicates_and_repoints_tasks(self):
        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0009_task_timestamps_finalize")])

        old_state = executor.loader.project_state([("tasks", "0009_task_timestamps_finalize")])
        OldUser = old_state.apps.get_model("auth", "User")
        OldCategory = old_state.apps.get_model("tasks", "Category")
        OldTask = old_state.apps.get_model("tasks", "Task")

        user = OldUser.objects.create(username="normalize@example.com", email="normalize@example.com")
        other = OldUser.objects.create(
            username="normalize-other@example.com",
            email="normalize-other@example.com",
        )
        survivor = OldCategory.objects.create(user_id=user.id, name="Straße")
        duplicate = OldCategory.objects.create(user_id=user.id, name="STRASSE")
        other_category = OldCategory.objects.create(user_id=other.id, name="STRASSE")
        OldCategory.objects.filter(pk=survivor.pk).update(
            created_at=datetime(2026, 8, 1, tzinfo=dt_timezone.utc),
        )
        OldCategory.objects.filter(pk=duplicate.pk).update(
            created_at=datetime(2026, 8, 2, tzinfo=dt_timezone.utc),
        )
        first_task = OldTask.objects.create(
            id=uuid_module.uuid4(),
            user_id=user.id,
            title="first",
            scope_kind="bucket",
            scope_value="",
            bucket_category_id=survivor.id,
        )
        second_task = OldTask.objects.create(
            id=uuid_module.uuid4(),
            user_id=user.id,
            title="second",
            scope_kind="bucket",
            scope_value="",
            bucket_category_id=duplicate.id,
        )

        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0012_category_normalized_name_finalize")])

        new_state = executor.loader.project_state([("tasks", "0012_category_normalized_name_finalize")])
        NewCategory = new_state.apps.get_model("tasks", "Category")
        NewTask = new_state.apps.get_model("tasks", "Task")

        categories = NewCategory.objects.filter(user_id=user.id)
        self.assertEqual(categories.count(), 1)
        self.assertEqual(categories.get().id, survivor.id)
        self.assertEqual(categories.get().name, "Straße")
        self.assertEqual(categories.get().normalized_name, "strasse")
        self.assertTrue(NewCategory.objects.filter(id=other_category.id).exists())
        self.assertEqual(NewTask.objects.get(id=first_task.id).bucket_category_id, survivor.id)
        self.assertEqual(NewTask.objects.get(id=second_task.id).bucket_category_id, survivor.id)

    def test_casefold_duplicate_inserted_between_backfill_and_finalize_is_merged(self):
        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0010_category_normalized_name")])

        old_state = executor.loader.project_state([("tasks", "0010_category_normalized_name")])
        OldUser = old_state.apps.get_model("auth", "User")
        OldCategory = old_state.apps.get_model("tasks", "Category")

        user = OldUser.objects.create(username="straggler@example.com", email="straggler@example.com")
        survivor = OldCategory.objects.create(user_id=user.id, name="Straße")

        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0011_category_normalized_name_backfill")])

        backfilled_state = executor.loader.project_state(
            [("tasks", "0011_category_normalized_name_backfill")]
        )
        BackfilledCategory = backfilled_state.apps.get_model("tasks", "Category")
        BackfilledTask = backfilled_state.apps.get_model("tasks", "Task")
        # Simulates an old writer after the primary backfill: it does not know
        # normalized_name exists, so a casefold-equivalent row arrives as NULL.
        duplicate = BackfilledCategory.objects.create(user_id=user.id, name="STRASSE")
        duplicate_task = BackfilledTask.objects.create(
            id=uuid_module.uuid4(),
            user_id=user.id,
            title="late duplicate task",
            scope_kind="bucket",
            scope_value="",
            bucket_category_id=duplicate.id,
        )

        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0012_category_normalized_name_finalize")])

        new_state = executor.loader.project_state([("tasks", "0012_category_normalized_name_finalize")])
        NewCategory = new_state.apps.get_model("tasks", "Category")
        NewTask = new_state.apps.get_model("tasks", "Task")
        categories = NewCategory.objects.filter(user_id=user.id)
        self.assertEqual(categories.count(), 1)
        self.assertEqual(categories.get().id, survivor.id)
        self.assertEqual(categories.get().normalized_name, "strasse")
        self.assertEqual(
            NewTask.objects.get(id=duplicate_task.id).bucket_category_id,
            survivor.id,
        )


class TaskVersionMigrationTests(TransactionTestCase):
    def test_existing_tasks_receive_version_one(self):
        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0012_category_normalized_name_finalize")])

        old_state = executor.loader.project_state([("tasks", "0012_category_normalized_name_finalize")])
        OldUser = old_state.apps.get_model("auth", "User")
        OldTask = old_state.apps.get_model("tasks", "Task")
        user = OldUser.objects.create(
            username="task-version@example.com",
            email="task-version@example.com",
        )
        task = OldTask.objects.create(
            id=uuid_module.uuid4(),
            user_id=user.id,
            title="existing task",
            scope_kind="day",
            scope_value="2026-08-06",
        )

        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0013_task_version")])

        new_state = executor.loader.project_state([("tasks", "0013_task_version")])
        NewTask = new_state.apps.get_model("tasks", "Task")
        self.assertEqual(NewTask.objects.get(id=task.id).version, 1)


class TruncateOverlengthSubtaskFieldsMigrationTests(TransactionTestCase):
    def test_truncates_overlength_legacy_subtask_id_and_title(self):
        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0013_task_version")])

        old_state = executor.loader.project_state([("tasks", "0013_task_version")])
        OldUser = old_state.apps.get_model("auth", "User")
        OldTask = old_state.apps.get_model("tasks", "Task")

        user = OldUser.objects.create(username="legacy-subtasks@example.com", email="legacy-subtasks@example.com")
        # Written directly against the pre-migration historical model,
        # bypassing SubtaskSerializer entirely — simulates data stored
        # before RF-006's length limit existed.
        task = OldTask.objects.create(
            id=uuid_module.uuid4(),
            user_id=user.id,
            title="legacy",
            scope_kind="day",
            scope_value="2026-08-06",
            subtasks=[
                {"id": "a" * 300, "title": "valid", "done": False},
                {"id": "valid-2", "title": "b" * 600, "done": False},
                {"id": "valid-3", "title": "unaffected", "done": True},
                "not-a-dict-entry",
            ],
        )

        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0014_truncate_overlength_subtask_fields")])

        new_state = executor.loader.project_state([("tasks", "0014_truncate_overlength_subtask_fields")])
        NewTask = new_state.apps.get_model("tasks", "Task")
        subtasks = NewTask.objects.get(id=task.id).subtasks

        self.assertEqual(len(subtasks[0]["id"]), 255)
        self.assertEqual(subtasks[0]["id"], "a" * 255)
        self.assertEqual(subtasks[0]["title"], "valid")
        self.assertEqual(subtasks[1]["id"], "valid-2")
        self.assertEqual(len(subtasks[1]["title"]), 500)
        self.assertEqual(subtasks[1]["title"], "b" * 500)
        self.assertEqual(subtasks[2], {"id": "valid-3", "title": "unaffected", "done": True})
        self.assertEqual(subtasks[3], "not-a-dict-entry")


class CategoryApiTests(TestCase):
    def test_list_only_returns_the_authenticated_users_own_categories_ordered_by_created_at(self):
        owner, owner_client = auth_client("cat-list-owner@example.com")
        other, _ = auth_client("cat-list-other@example.com")
        first = Category.objects.create(user=owner, name="To Go")
        Category.objects.create(user=other, name="Not Mine")
        second = Category.objects.create(user=owner, name="To Eat")

        response = owner_client.get("/api/categories/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual([c["id"] for c in response.data], [str(first.id), str(second.id)])

    def test_create_makes_a_new_category(self):
        owner, client = auth_client("cat-create@example.com")

        response = client.post("/api/categories/", {"name": "  To Eat  "}, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["name"], "To Eat")
        self.assertEqual(Category.objects.filter(user=owner).count(), 1)

    def test_create_with_a_case_insensitive_duplicate_name_reuses_the_existing_category(self):
        owner, client = auth_client("cat-create-dupe@example.com")
        existing = Category.objects.create(user=owner, name="To Eat")

        response = client.post("/api/categories/", {"name": "to eat"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["id"], str(existing.id))
        self.assertEqual(Category.objects.filter(user=owner).count(), 1)

    def test_create_reuses_a_unicode_casefold_equivalent_category(self):
        owner, client = auth_client("cat-create-unicode-dupe@example.com")
        existing = Category.objects.create(user=owner, name="Straße")

        response = client.post("/api/categories/", {"name": "STRASSE"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["id"], str(existing.id))
        self.assertEqual(response.data["name"], "Straße")
        self.assertEqual(Category.objects.filter(user=owner).count(), 1)

    def test_create_rejects_a_blank_name(self):
        owner, client = auth_client("cat-create-blank@example.com")

        response = client.post("/api/categories/", {"name": "   "}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Category.objects.filter(user=owner).count(), 0)

    def test_create_rejects_a_name_whose_normalized_key_exceeds_the_column(self):
        owner, client = auth_client("cat-create-expansion@example.com")

        response = client.post("/api/categories/", {"name": "\ufdfa" * 11}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("normalized", str(response.data).lower())
        self.assertEqual(Category.objects.filter(user=owner).count(), 0)

    def test_create_converts_a_model_level_validation_error_into_a_clean_400(self):
        # CategorySerializer.validate_name already enforces the 180-char
        # boundary, so Category.save()'s own check is unreachable through
        # this view today — this proves the defense-in-depth path itself,
        # in case a future caller ever reaches get_or_create() with a name
        # the serializer didn't validate. Without the view's
        # ValidationError catch, this would surface as an unhandled 500
        # (django.core.exceptions.ValidationError isn't one DRF's default
        # exception handler translates).
        owner, client = auth_client("cat-create-model-validation@example.com")

        with patch(
            "apps.tasks.views.Category.objects.get_or_create",
            side_effect=DjangoValidationError({"name": "forced for test"}),
        ):
            response = client.post("/api/categories/", {"name": "To Eat"}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.data)

    def test_rename_converts_a_model_level_validation_error_into_a_clean_400(self):
        owner, client = auth_client("cat-rename-model-validation@example.com")
        category = Category.objects.create(user=owner, name="To Go")

        with patch(
            "apps.tasks.models.Category.save",
            side_effect=DjangoValidationError({"name": "forced for test"}),
        ):
            response = client.patch(f"/api/categories/{category.id}/", {"name": "To Visit"}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.data)

    def test_a_different_users_category_with_the_same_name_is_not_reused(self):
        owner, owner_client = auth_client("cat-create-scope@example.com")
        other, _ = auth_client("cat-create-scope-other@example.com")
        Category.objects.create(user=other, name="To Eat")

        response = owner_client.post("/api/categories/", {"name": "To Eat"}, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Category.objects.filter(user=owner).count(), 1)

    def test_rename_updates_the_name(self):
        owner, client = auth_client("cat-rename@example.com")
        category = Category.objects.create(user=owner, name="To Go")

        response = client.patch(f"/api/categories/{category.id}/", {"name": "To Visit"}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["name"], "To Visit")
        category.refresh_from_db()
        self.assertEqual(category.name, "To Visit")

    def test_rename_rejects_a_case_insensitive_collision_with_another_category(self):
        owner, client = auth_client("cat-rename-collision@example.com")
        Category.objects.create(user=owner, name="To Eat")
        to_go = Category.objects.create(user=owner, name="To Go")

        response = client.patch(f"/api/categories/{to_go.id}/", {"name": "to eat"}, format="json")

        self.assertEqual(response.status_code, 400)
        to_go.refresh_from_db()
        self.assertEqual(to_go.name, "To Go")

    def test_rename_rejects_a_blank_name(self):
        owner, client = auth_client("cat-rename-blank@example.com")
        category = Category.objects.create(user=owner, name="To Go")

        response = client.patch(f"/api/categories/{category.id}/", {"name": "   "}, format="json")

        self.assertEqual(response.status_code, 400)
        category.refresh_from_db()
        self.assertEqual(category.name, "To Go")

    def test_rename_rejects_a_name_whose_normalized_key_exceeds_the_column(self):
        owner, client = auth_client("cat-rename-expansion@example.com")
        category = Category.objects.create(user=owner, name="To Go")

        response = client.patch(
            f"/api/categories/{category.id}/",
            {"name": "\ufdfa" * 11},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        category.refresh_from_db()
        self.assertEqual(category.name, "To Go")

    def test_cannot_rename_another_users_category(self):
        owner, _ = auth_client("cat-rename-owner@example.com")
        _, other_client = auth_client("cat-rename-attacker@example.com")
        category = Category.objects.create(user=owner, name="To Go")

        response = other_client.patch(f"/api/categories/{category.id}/", {"name": "Hijacked"}, format="json")

        self.assertEqual(response.status_code, 404)
        category.refresh_from_db()
        self.assertEqual(category.name, "To Go")


class ProductionStaticFilesTests(SimpleTestCase):
    def test_whitenoise_middleware_runs_directly_after_security_middleware(self):
        security_index = settings.MIDDLEWARE.index("django.middleware.security.SecurityMiddleware")
        self.assertEqual(
            settings.MIDDLEWARE[security_index + 1],
            "whitenoise.middleware.WhiteNoiseMiddleware",
        )

    def test_static_root_is_configured(self):
        self.assertEqual(settings.STATIC_ROOT.name, "staticfiles")

    def test_staticfiles_storage_uses_whitenoise_compressed_manifest(self):
        self.assertEqual(
            settings.STORAGES["staticfiles"]["BACKEND"],
            "whitenoise.storage.CompressedManifestStaticFilesStorage",
        )

    def test_default_file_storage_is_still_explicitly_configured(self):
        # STORAGES is not deep-merged with Django's built-in defaults — if this
        # project ever adds a FileField/ImageField, an accidentally-omitted
        # "default" key here would silently misconfigure it project-wide.
        self.assertEqual(
            settings.STORAGES["default"]["BACKEND"],
            "django.core.files.storage.FileSystemStorage",
        )

    def test_secure_proxy_ssl_header_trusts_nginxs_forwarded_proto(self):
        # nginx terminates TLS and proxies to gunicorn over plain HTTP; without
        # this, request.is_secure() is always False behind the proxy and admin
        # login fails CSRF's origin check.
        self.assertEqual(
            settings.SECURE_PROXY_SSL_HEADER,
            ("HTTP_X_FORWARDED_PROTO", "https"),
        )

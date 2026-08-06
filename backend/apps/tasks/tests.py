import uuid

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from .models import Category, Task


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
            client.post("/api/tasks/", make_task_payload(completed_at="x" * 33), format="json").status_code,
            400,
        )
        self.assertEqual(
            client.post("/api/tasks/", make_task_payload(duration_minutes=-5), format="json").status_code,
            400,
        )

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
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["order"], 2.5)


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
        update_response = client.put(f"/api/tasks/{task_id}/", payload, format="json")
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
    def test_two_users_can_each_have_a_category_with_the_same_name(self):
        owner, _ = auth_client("cat-owner@example.com")
        other, _ = auth_client("cat-other@example.com")
        Category.objects.create(user=owner, name="To Eat")
        Category.objects.create(user=other, name="To Eat")  # no IntegrityError

        self.assertEqual(Category.objects.filter(name="To Eat").count(), 2)

    def test_exact_duplicate_name_for_the_same_user_is_rejected_at_the_db_level(self):
        from django.db import IntegrityError

        owner, _ = auth_client("cat-dupe@example.com")
        Category.objects.create(user=owner, name="To Eat")
        with self.assertRaises(IntegrityError):
            Category.objects.create(user=owner, name="To Eat")


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

        new_garbage_completed = NewTask.objects.get(id=garbage_completed.id)
        self.assertEqual(new_garbage_completed.completed_at, new_garbage_completed.updated_at)

        new_never_completed = NewTask.objects.get(id=never_completed.id)
        self.assertIsNone(new_never_completed.completed_at)

        new_out_of_range_created = NewTask.objects.get(id=out_of_range_created.id)
        self.assertEqual(new_out_of_range_created.created_at, new_out_of_range_created.updated_at)

        new_out_of_range_completed = NewTask.objects.get(id=out_of_range_completed.id)
        self.assertEqual(new_out_of_range_completed.completed_at, new_out_of_range_completed.updated_at)


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

    def test_create_rejects_a_blank_name(self):
        owner, client = auth_client("cat-create-blank@example.com")

        response = client.post("/api/categories/", {"name": "   "}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Category.objects.filter(user=owner).count(), 0)

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

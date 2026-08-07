from dataclasses import dataclass
from typing import Any

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from .models import Task
from .serializers import SUBTASK_TITLE_MAX_LENGTH


User = get_user_model()


class TaskCommandNotFound(Exception):
    pass


class TaskVersionConflict(Exception):
    def __init__(self, current_versions: dict[str, int]):
        super().__init__("One or more tasks changed after they were loaded.")
        self.current_versions = current_versions


class TaskCommandConflict(Exception):
    def __init__(self, code: str, detail: str, **extra: Any):
        super().__init__(detail)
        self.code = code
        self.detail = detail
        self.extra = extra


@dataclass(frozen=True)
class NestTaskResult:
    target: Task
    removed_task_id: str


@dataclass(frozen=True)
class PromoteSubtaskResult:
    parent: Task
    task: Task


def _lock_user(user):
    # Serializing commands per owner gives sibling-order calculations a stable
    # boundary even when two commands touch different Task rows.
    User._default_manager.select_for_update().get(pk=user.pk)


def _locked_owned_tasks(user, task_ids) -> dict[str, Task]:
    tasks = (
        Task.objects.select_for_update()
        .filter(user=user, id__in=task_ids)
        .order_by("id")
    )
    return {str(task.id): task for task in tasks}


def _assert_versions(expected: dict[str, int], tasks: dict[str, Task]):
    current = {task_id: task.version for task_id, task in tasks.items()}
    if any(current.get(task_id) != version for task_id, version in expected.items()):
        raise TaskVersionConflict(current)


def _nest_data_loss_fields(task: Task) -> list[str]:
    fields = []
    if task.memo:
        fields.append("memo")
    if task.completed_at:
        fields.append("completed_at")
    if task.time:
        fields.append("time")
    if task.duration_minutes:
        fields.append("duration_minutes")
    if task.priority:
        fields.append("priority")
    if task.due_date:
        fields.append("due_date")
    if task.background:
        fields.append("background")
    if task.rolled_from_kind or task.rolled_from_value:
        fields.append("rollover_history")
    if task.excluded_dates:
        fields.append("excluded_dates")
    return fields


@transaction.atomic
def nest_task(
    *,
    user,
    source_id,
    target_id,
    source_version: int,
    target_version: int,
    subtask_id: str,
    confirm_data_loss: bool,
) -> NestTaskResult:
    if source_id == target_id:
        raise TaskCommandConflict("same_task", "A task cannot be nested into itself.")

    _lock_user(user)
    task_ids = [source_id, target_id]
    tasks = _locked_owned_tasks(user, task_ids)
    source_key = str(source_id)
    target_key = str(target_id)
    if source_key not in tasks or target_key not in tasks:
        raise TaskCommandNotFound

    source = tasks[source_key]
    target = tasks[target_key]
    _assert_versions(
        {source_key: source_version, target_key: target_version},
        tasks,
    )

    if source.subtasks:
        raise TaskCommandConflict(
            "source_has_subtasks",
            "A task that already has subtasks cannot be nested.",
        )
    if source.repeat_weekdays or source.repeat_source_id:
        raise TaskCommandConflict(
            "source_is_repeating",
            "A repeating task must be detached before it can be nested.",
        )
    if source.occurrences.exists():
        raise TaskCommandConflict(
            "source_has_occurrences",
            "A task with generated occurrences cannot be nested.",
        )

    target_subtasks = list(target.subtasks or [])
    if any(subtask.get("id") == subtask_id for subtask in target_subtasks):
        raise TaskCommandConflict(
            "duplicate_subtask_id",
            "The target already contains this subtask id.",
        )

    lost_fields = _nest_data_loss_fields(source)
    if lost_fields and not confirm_data_loss:
        raise TaskCommandConflict(
            "data_loss_confirmation_required",
            "Confirm the task-only fields that will be discarded.",
            lost_fields=lost_fields,
        )

    target.subtasks = [
        *target_subtasks,
        {"id": subtask_id, "title": source.title, "done": source.done},
    ]
    target.version += 1
    target.save(update_fields=["subtasks", "version", "updated_at"])
    removed_task_id = str(source.id)
    source.delete()

    return NestTaskResult(target=target, removed_task_id=removed_task_id)


def _promotion_order(user, parent: Task) -> float:
    if parent.scope_kind != "day":
        return 0.0

    siblings = list(
        Task.objects.select_for_update()
        .filter(
            user=user,
            scope_kind="day",
            scope_value=parent.scope_value,
            done=False,
        )
        .filter(Q(time__isnull=True) | Q(time=""))
        .order_by("order", "id")
    )
    if parent.time:
        return max([0.0, *(task.order for task in siblings)]) + 1.0

    next_sibling = next((task for task in siblings if task.order > parent.order), None)
    if next_sibling is None:
        return parent.order + 1.0
    return (parent.order + next_sibling.order) / 2.0


@transaction.atomic
def promote_subtask(
    *,
    user,
    parent_id,
    subtask_id: str,
    parent_version: int,
    new_task_id,
) -> PromoteSubtaskResult:
    _lock_user(user)
    parent_key = str(parent_id)
    tasks = _locked_owned_tasks(user, [parent_id])
    if parent_key not in tasks:
        raise TaskCommandNotFound

    parent = tasks[parent_key]
    _assert_versions({parent_key: parent_version}, tasks)

    matches = [subtask for subtask in (parent.subtasks or []) if subtask.get("id") == subtask_id]
    if not matches:
        raise TaskCommandConflict("subtask_not_found", "The subtask no longer exists.")
    if len(matches) > 1:
        raise TaskCommandConflict(
            "duplicate_subtask_id",
            "The parent contains ambiguous duplicate subtask ids.",
        )
    if Task.objects.filter(id=new_task_id).exists():
        raise TaskCommandConflict("task_id_conflict", "The new task id is already in use.")

    subtask = matches[0]
    raw_title = subtask.get("title")
    subtask_title = raw_title.strip() if isinstance(raw_title, str) else raw_title
    if (
        not isinstance(subtask_title, str)
        or not subtask_title
        or len(subtask_title) > SUBTASK_TITLE_MAX_LENGTH
    ):
        raise TaskCommandConflict(
            "invalid_subtask_title",
            "The subtask title cannot be promoted safely.",
        )
    if not isinstance(subtask.get("done"), bool):
        raise TaskCommandConflict(
            "invalid_subtask_done",
            "The subtask completion state is invalid.",
        )
    order = _promotion_order(user, parent)
    remaining_subtasks = [
        subtask_item
        for subtask_item in (parent.subtasks or [])
        if subtask_item.get("id") != subtask_id
    ]

    task = Task(
        id=new_task_id,
        user=user,
        title=subtask_title,
        done=subtask["done"],
        completed_at=timezone.now() if subtask["done"] else None,
        scope_kind=parent.scope_kind,
        scope_value=parent.scope_value,
        bucket_category=parent.bucket_category,
        order=order,
    )
    try:
        # Keep the insert in its own savepoint. If it loses the UUID race,
        # the outer transaction remains usable so we can distinguish that
        # expected conflict from an unrelated database integrity failure.
        with transaction.atomic():
            task.save(force_insert=True)
    except IntegrityError as exc:
        if Task.objects.filter(id=new_task_id).exists():
            raise TaskCommandConflict(
                "task_id_conflict",
                "The new task id is already in use.",
            ) from exc
        raise

    parent.subtasks = remaining_subtasks
    parent.version += 1
    parent.save(update_fields=["subtasks", "version", "updated_at"])

    return PromoteSubtaskResult(parent=parent, task=task)

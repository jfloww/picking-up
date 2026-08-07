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


@dataclass(frozen=True)
class DetachTaskResult:
    occurrence: Task
    anchor: Task | None


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


def _current_effective_date(task: Task) -> str | None:
    if task.scope_kind == "day":
        return task.scope_value
    if task.scope_kind == "week" and task.rolled_from_kind == "day":
        return task.rolled_from_value
    return None


_EDGE_GAP = 1.0


def _order_between(before: float | None, after: float | None) -> float:
    if before is None and after is None:
        return 0.0
    if before is None:
        return after - _EDGE_GAP
    if after is None:
        return before + _EDGE_GAP
    return (before + after) / 2.0


def _append_anchor_exclusion(user, occurrence: Task) -> Task | None:
    # Additive set-union onto the anchor's excluded_dates — never a whole-
    # array replace — so a concurrent exclusion from another writer always
    # survives regardless of what this command does. No anchor_version
    # precondition: the owner-row lock (_lock_user, already held by every
    # caller) is the only concurrency guarantee this write needs, since the
    # write is idempotent (adding the same date twice is a no-op).
    anchor_id = occurrence.repeat_source_id
    if not anchor_id:
        return None
    anchors = _locked_owned_tasks(user, [anchor_id])
    anchor = anchors.get(str(anchor_id))
    if anchor is None:
        return None
    date = _current_effective_date(occurrence)
    if date is None:
        return None
    existing = set(anchor.excluded_dates or [])
    if date in existing:
        return anchor
    anchor.excluded_dates = [*(anchor.excluded_dates or []), date]
    anchor.version += 1
    anchor.save(update_fields=["excluded_dates", "version", "updated_at"])
    return anchor


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


@transaction.atomic
def detach_task(
    *,
    user,
    occurrence_id,
    occurrence_version: int,
    repeat_weekdays: list[int] | None,
) -> DetachTaskResult:
    _lock_user(user)
    occurrence_key = str(occurrence_id)
    tasks = _locked_owned_tasks(user, [occurrence_id])
    if occurrence_key not in tasks:
        raise TaskCommandNotFound

    occurrence = tasks[occurrence_key]
    _assert_versions({occurrence_key: occurrence_version}, tasks)

    # Must run before repeat_source is cleared below — it reads
    # occurrence.repeat_source_id to find the anchor.
    anchor = _append_anchor_exclusion(user, occurrence)

    occurrence.repeat_source = None
    occurrence.repeat_weekdays = repeat_weekdays
    occurrence.version += 1
    occurrence.save(
        update_fields=["repeat_source", "repeat_weekdays", "version", "updated_at"]
    )

    return DetachTaskResult(occurrence=occurrence, anchor=anchor)


@dataclass(frozen=True)
class DeleteOccurrenceResult:
    removed_task_id: str
    anchor: Task | None


@transaction.atomic
def delete_occurrence(
    *,
    user,
    occurrence_id,
    occurrence_version: int,
) -> DeleteOccurrenceResult:
    _lock_user(user)
    occurrence_key = str(occurrence_id)
    tasks = _locked_owned_tasks(user, [occurrence_id])
    if occurrence_key not in tasks:
        raise TaskCommandNotFound

    occurrence = tasks[occurrence_key]
    _assert_versions({occurrence_key: occurrence_version}, tasks)

    # Must run before occurrence.delete() below — it reads
    # occurrence.repeat_source_id and the occurrence's effective date, both
    # of which need the row to still exist and be unmutated.
    anchor = _append_anchor_exclusion(user, occurrence)
    removed_task_id = str(occurrence.id)
    occurrence.delete()

    return DeleteOccurrenceResult(removed_task_id=removed_task_id, anchor=anchor)


@dataclass(frozen=True)
class RescheduleTaskResult:
    task: Task
    anchor: Task | None


@transaction.atomic
def reschedule_task(
    *,
    user,
    task_id,
    task_version: int,
    date: str,
) -> RescheduleTaskResult:
    _lock_user(user)
    task_key = str(task_id)
    tasks = _locked_owned_tasks(user, [task_id])
    if task_key not in tasks:
        raise TaskCommandNotFound

    task = tasks[task_key]
    _assert_versions({task_key: task_version}, tasks)

    current_date = _current_effective_date(task)
    if current_date is None:
        raise TaskCommandConflict(
            "not_reschedulable",
            "Only a day-scoped task or a rolled-over week-scoped task can be rescheduled.",
        )
    if current_date == date:
        raise TaskCommandConflict("same_date", "The task is already scheduled on this date.")

    # Must run before repeat_source is cleared below.
    anchor = _append_anchor_exclusion(user, task)

    if not task.time:
        # Mirrors the frontend's current dayTasksForWeek-based scan: counts
        # both day-scoped tasks already on the destination date and
        # week-scoped tasks rolled over from it, including done tasks
        # (position, not completion, drives this list). Unlike the
        # frontend, this query doesn't also require scope_value/weekStart
        # to match the destination's current week: a week-scoped task that
        # rolled off `date` and has since rolled forward again (weekStart
        # now a later week, rolled_from_value still `date`) matches here
        # but wouldn't match dayTasksForWeek on the frontend. There's no
        # week_start_of helper on the backend today to close that gap, and
        # it's harmless to leave open — the extra rows can only inflate the
        # computed max(), so the rescheduled task still lands past every
        # currently-visible sibling; it never causes an incorrect exclusion
        # or lost order value, just a possibly-larger-than-strictly-
        # necessary one.
        siblings = list(
            Task.objects.select_for_update()
            .filter(user=user)
            .filter(
                Q(scope_kind="day", scope_value=date)
                | Q(scope_kind="week", rolled_from_kind="day", rolled_from_value=date)
            )
            .filter(Q(time__isnull=True) | Q(time=""))
        )
        task.order = max([0.0, *(sibling.order for sibling in siblings)]) + 1.0

    task.scope_kind = "day"
    task.scope_value = date
    task.rolled_from_kind = None
    task.rolled_from_value = None
    task.repeat_source = None
    task.version += 1
    task.save(
        update_fields=[
            "scope_kind", "scope_value", "rolled_from_kind", "rolled_from_value",
            "repeat_source", "order", "version", "updated_at",
        ]
    )

    return RescheduleTaskResult(task=task, anchor=anchor)


@dataclass(frozen=True)
class ReorderTaskResult:
    task: Task


@transaction.atomic
def reorder_task(
    *,
    user,
    task_id,
    task_version: int,
    insert_before_id,
) -> ReorderTaskResult:
    _lock_user(user)
    task_key = str(task_id)
    tasks = _locked_owned_tasks(user, [task_id])
    if task_key not in tasks:
        raise TaskCommandNotFound

    task = tasks[task_key]
    _assert_versions({task_key: task_version}, tasks)

    date = _current_effective_date(task)
    if task.time or date is None:
        raise TaskCommandConflict(
            "not_reorderable",
            "Only an untimed day-scoped or rolled-over week-scoped task can be reordered.",
        )

    # Same sibling rule reschedule_task uses: day-scope or rolled-over
    # week-scope at this date, untimed, not filtered by done — Weekly
    # interleaves done and not-done untimed tasks in one order-sorted list,
    # so a done sibling must still count.
    siblings = list(
        Task.objects.select_for_update()
        .filter(user=user)
        .filter(
            Q(scope_kind="day", scope_value=date)
            | Q(scope_kind="week", rolled_from_kind="day", rolled_from_value=date)
        )
        .filter(Q(time__isnull=True) | Q(time=""))
        .exclude(id=task.id)
        .order_by("order", "id")
    )

    if insert_before_id is None:
        before = siblings[-1] if siblings else None
        after = None
    else:
        insert_before_key = str(insert_before_id)
        match_index = next(
            (i for i, sibling in enumerate(siblings) if str(sibling.id) == insert_before_key),
            None,
        )
        if match_index is None:
            raise TaskCommandConflict(
                "invalid_neighbor",
                "The neighbor task is not a valid insertion point.",
            )
        after = siblings[match_index]
        before = siblings[match_index - 1] if match_index > 0 else None

    task.order = _order_between(
        before.order if before else None,
        after.order if after else None,
    )
    task.version += 1
    task.save(update_fields=["order", "version", "updated_at"])

    return ReorderTaskResult(task=task)


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

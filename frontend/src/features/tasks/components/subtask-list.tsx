"use client";

import { ArrowUpRight, GripVertical, Plus, X } from "lucide-react";
import { useRef, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Subtask } from "../types";
import { QuickAdd } from "./quick-add";
import { useDragToReorder } from "./use-drag-to-reorder";
import {
  prefersReducedMotion,
  SUBTASK_TRANSITION_DURATION_MS,
  useSubtaskTransitionClasses,
  type SubtaskRenderState,
} from "./use-subtask-transition-classes";

// Handle-bag type derived from the hook itself (not hand-duplicated) so it
// can't drift if useDragToReorder's return shape ever changes.
type ReorderHandlers = ReturnType<ReturnType<typeof useDragToReorder>["getDragHandlers"]>;

// Cardless, ~40px row: checkbox, click-to-edit title, and a delete control
// that only shows on hover/focus/while editing — never a permanent "×" per
// row, which reads as noisy at this density.
//
// Delete's fade-out is driven locally (a click handler, not a prop diff):
// the button click already knows exactly which row is leaving, so this
// defers the real onRemove call until the animation finishes instead of
// needing to reconcile a removed id back into its old list position from
// the subtasks array alone (see use-subtask-transition-classes.ts).
function DrawerSubtaskRow({
  subtask,
  onToggle,
  onRemove,
  onOpen,
  onPromote,
  animationClass,
  reorderable = false,
  getReorderHandlers,
  itemRef,
  showDropIndicatorAbove = false,
}: {
  subtask: Subtask;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onOpen?: (subtaskId: string) => void;
  onPromote?: (subtaskId: string) => void;
  animationClass?: string;
  reorderable?: boolean;
  getReorderHandlers?: (id: string, title: string) => ReorderHandlers;
  itemRef?: (el: HTMLLIElement | null) => void;
  showDropIndicatorAbove?: boolean;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleRemove = () => {
    if (prefersReducedMotion()) {
      onRemove(subtask.id);
      return;
    }
    setDeleting(true);
    setTimeout(() => onRemove(subtask.id), SUBTASK_TRANSITION_DURATION_MS);
  };

  return (
    <li
      ref={itemRef}
      className={cn(
        // border-t-2 border-transparent is the baseline (not just added
        // when active) so toggling the drop indicator never changes the
        // row's box height — box-sizing: border-box (Tailwind's preflight)
        // means this border eats into the existing h-10 box, not adds to it.
        "group flex h-10 items-center gap-2.5 rounded-md border-t-2 border-transparent px-1.5 transition-colors duration-200 hover:bg-muted/40 focus-within:bg-muted/40",
        showDropIndicatorAbove && "border-brand",
        deleting ? "animate-subtask-exit" : animationClass,
      )}
    >
      {reorderable && getReorderHandlers && (
        <button
          type="button"
          aria-label={`Reorder ${subtask.title}`}
          className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-subtle outline-none transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing"
          {...getReorderHandlers(subtask.id, subtask.title)}
        >
          <GripVertical className="size-3.5" />
        </button>
      )}
      <Checkbox
        checked={subtask.done}
        onCheckedChange={() => onToggle(subtask.id)}
        aria-label={`Toggle ${subtask.title}`}
        className="shrink-0 border-subtle"
      />
      <button
        type="button"
        onClick={() => onOpen?.(subtask.id)}
        className={cn(
          "min-w-0 flex-1 truncate rounded-md px-1 py-1 text-left text-sm text-foreground/80 outline-none transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
          subtask.done && "text-muted-foreground line-through hover:text-muted-foreground",
        )}
      >
        {subtask.title}
      </button>
      {onPromote && (
        <button
          type="button"
          onClick={() => onPromote(subtask.id)}
          aria-label={`Move ${subtask.title} out as its own task`}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle opacity-0 outline-none transition-opacity duration-200 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <ArrowUpRight className="size-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={handleRemove}
        aria-label={`Delete ${subtask.title}`}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-subtle opacity-0 outline-none transition-opacity duration-200 hover:bg-muted hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}

function DrawerSubtaskList({
  subtasks,
  renderStates,
  onAdd,
  onToggle,
  onRemove,
  onOpenSubtask,
  onPromote,
  onReorder,
}: {
  subtasks: Subtask[];
  renderStates: Map<string, SubtaskRenderState>;
  onAdd: (title: string) => void;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onOpenSubtask?: (subtaskId: string) => void;
  onPromote?: (subtaskId: string) => void;
  onReorder?: (subtaskId: string, insertBeforeId: string | null) => void;
}) {
  const withRenderState = subtasks.map((s) => ({
    subtask: s,
    state: renderStates.get(s.id),
  }));
  // Grouping uses the (possibly delayed) render-state `done` value, not the
  // live one, so a just-toggled row stays in its old section for the
  // duration of its exit animation instead of jumping to the new section
  // on the very next render.
  const active = withRenderState.filter((x) => !(x.state?.done ?? x.subtask.done));
  const completed = withRenderState.filter((x) => x.state?.done ?? x.subtask.done);

  const reorderContainerRef = useRef<HTMLDivElement | null>(null);
  const reorderItemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Only active subtasks are reorderable, matching the existing top-level
  // task reorder's scope (day-agenda.tsx's allDayToDo excludes done tasks
  // the same way) — dragging a completed subtask back into order isn't
  // supported here.
  const { dragState: reorderDragState, getDragHandlers: getReorderHandlers } = useDragToReorder({
    containerRef: reorderContainerRef,
    itemRefs: reorderItemRefs,
    orderedIds: active.map(({ subtask: s }) => s.id),
    onReorder: (id, insertBeforeId) => onReorder?.(id, insertBeforeId),
  });

  return (
    <div className="space-y-1">
      {(active.length > 0 || completed.length > 0) && (
        <div ref={reorderContainerRef} data-testid="drawer-subtask-list">
          <ul>
            {active.map(({ subtask: s, state }) => {
              const reorderable = !!onReorder;
              return (
                <DrawerSubtaskRow
                  key={s.id}
                  subtask={s}
                  onToggle={onToggle}
                  onRemove={onRemove}
                  onOpen={onOpenSubtask}
                  onPromote={onPromote}
                  animationClass={state?.enterAnimationClass ?? state?.sectionAnimationClass}
                  reorderable={reorderable}
                  getReorderHandlers={reorderable ? getReorderHandlers : undefined}
                  itemRef={
                    reorderable
                      ? (el) => {
                          // itemRefs is typed for HTMLDivElement (matching
                          // useDragToReorder's interface), but subtask rows
                          // are <li>; the hook only calls
                          // getBoundingClientRect() on it, which every
                          // HTMLElement supports, so this cast is safe (same
                          // pattern as scope-tasks.tsx's task rows).
                          reorderItemRefs.current[s.id] = el as unknown as HTMLDivElement | null;
                        }
                      : undefined
                  }
                  showDropIndicatorAbove={
                    reorderable &&
                    !!reorderDragState?.insideList &&
                    reorderDragState.insertBeforeId === s.id
                  }
                />
              );
            })}
            {/* insertBeforeId is a meaningful value from useDragToReorder,
                not just "nothing" — null specifically means "past every
                active row, at the end of the list" (see the hook's own
                doc comment on ReorderDragState.insertBeforeId), which is a
                fully valid, common drop target that still needs feedback.
                Mirrors scope-tasks.tsx's handling of the same null case for
                its own reorder drag, using the same border-t-2 border-brand
                treatment DrawerSubtaskRow uses for the row-specific case
                above, just as a standalone trailing row instead of a
                border on some other row. */}
            {!!onReorder && !!reorderDragState?.insideList && reorderDragState.insertBeforeId === null && (
              <li
                data-testid="reorder-indicator-end"
                aria-hidden
                className="border-t-2 border-brand"
              />
            )}
            {completed.map(({ subtask: s, state }) => (
              <DrawerSubtaskRow
                key={s.id}
                subtask={s}
                onToggle={onToggle}
                onRemove={onRemove}
                onOpen={onOpenSubtask}
                onPromote={onPromote}
                animationClass={state?.enterAnimationClass ?? state?.sectionAnimationClass}
              />
            ))}
          </ul>
        </div>
      )}
      <div className="group flex h-10 items-center gap-2.5 rounded-md px-1.5 text-foreground/70 transition-colors duration-200 hover:bg-muted/40 focus-within:bg-muted/40">
        <Plus
          className="size-3.5 shrink-0 transition-colors duration-200 group-hover:text-amber group-focus-within:text-amber"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <QuickAdd onAdd={onAdd} placeholder="Add a subtask" />
        </div>
      </div>
    </div>
  );
}

// The default (non-drawer) list never regroups by done — a toggled
// subtask keeps its position, so it only needs the enter/delete animations,
// not the section-move one DrawerSubtaskRow also plays.
function PlainSubtaskRow({
  subtask,
  onToggle,
  onRemove,
  animationClass,
}: {
  subtask: Subtask;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  animationClass?: string;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleRemove = () => {
    if (prefersReducedMotion()) {
      onRemove(subtask.id);
      return;
    }
    setDeleting(true);
    setTimeout(() => onRemove(subtask.id), SUBTASK_TRANSITION_DURATION_MS);
  };

  return (
    <li
      className={cn("flex items-center gap-2", deleting ? "animate-subtask-exit" : animationClass)}
    >
      <Checkbox
        checked={subtask.done}
        onCheckedChange={() => onToggle(subtask.id)}
        aria-label={`Toggle ${subtask.title}`}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-xs",
          subtask.done && "text-muted-foreground line-through",
        )}
      >
        {subtask.title}
      </span>
      <button
        type="button"
        onClick={handleRemove}
        aria-label={`Delete ${subtask.title}`}
        className="text-xs text-subtle hover:text-destructive"
      >
        ×
      </button>
    </li>
  );
}

export function SubtaskList({
  subtasks,
  onAdd,
  onToggle,
  onRemove,
  onOpenSubtask,
  onPromote,
  onReorder,
  drawer = false,
}: {
  subtasks: Subtask[];
  onAdd: (title: string) => void;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onOpenSubtask?: (subtaskId: string) => void;
  onPromote?: (subtaskId: string) => void;
  onReorder?: (subtaskId: string, insertBeforeId: string | null) => void;
  drawer?: boolean;
}) {
  // Called once here (not separately in DrawerSubtaskList) so drawer mode
  // doesn't run two independent copies of the same timer bookkeeping for
  // the same subtasks array.
  const renderStates = useSubtaskTransitionClasses(subtasks);

  if (drawer) {
    return (
      <DrawerSubtaskList
        subtasks={subtasks}
        renderStates={renderStates}
        onAdd={onAdd}
        onToggle={onToggle}
        onRemove={onRemove}
        onOpenSubtask={onOpenSubtask}
        onPromote={onPromote}
        onReorder={onReorder}
      />
    );
  }

  return (
    <div className="space-y-1">
      <ul className="space-y-0.5">
        {subtasks.map((s) => (
          <PlainSubtaskRow
            key={s.id}
            subtask={s}
            onToggle={onToggle}
            onRemove={onRemove}
            animationClass={renderStates.get(s.id)?.enterAnimationClass}
          />
        ))}
      </ul>
      <QuickAdd onAdd={onAdd} placeholder="Add subtask" />
    </div>
  );
}

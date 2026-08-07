"use client";

import { ArrowUpRight, Plus, X } from "lucide-react";
import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Subtask } from "../types";
import { QuickAdd } from "./quick-add";
import {
  prefersReducedMotion,
  SUBTASK_TRANSITION_DURATION_MS,
  useSubtaskTransitionClasses,
  type SubtaskRenderState,
} from "./use-subtask-transition-classes";

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
}: {
  subtask: Subtask;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onOpen?: (subtaskId: string) => void;
  onPromote?: (subtaskId: string) => void;
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
      className={cn(
        "group flex h-10 items-center gap-2.5 rounded-md px-1.5 transition-colors duration-200 hover:bg-muted/40 focus-within:bg-muted/40",
        deleting ? "animate-subtask-exit" : animationClass,
      )}
    >
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
}: {
  subtasks: Subtask[];
  renderStates: Map<string, SubtaskRenderState>;
  onAdd: (title: string) => void;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onOpenSubtask?: (subtaskId: string) => void;
  onPromote?: (subtaskId: string) => void;
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

  return (
    <div className="space-y-1">
      {(active.length > 0 || completed.length > 0) && (
        <ul>
          {[...active, ...completed].map(({ subtask: s, state }) => (
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
  drawer = false,
}: {
  subtasks: Subtask[];
  onAdd: (title: string) => void;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onOpenSubtask?: (subtaskId: string) => void;
  onPromote?: (subtaskId: string) => void;
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

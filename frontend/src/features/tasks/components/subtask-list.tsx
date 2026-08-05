"use client";

import { ArrowUpRight, Plus, X } from "lucide-react";
import { useRef, useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Subtask } from "../types";
import { QuickAdd } from "./quick-add";

// Cardless, ~40px row: checkbox, click-to-edit title, and a delete control
// that only shows on hover/focus/while editing — never a permanent "×" per
// row, which reads as noisy at this density.
function DrawerSubtaskRow({
  subtask,
  onToggle,
  onRemove,
  onEditTitle,
  onPromote,
}: {
  subtask: Subtask;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onEditTitle: (subtaskId: string, title: string) => void;
  onPromote?: (subtaskId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(subtask.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = () => {
    setValue(subtask.title);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed && trimmed !== subtask.title) onEditTitle(subtask.id, trimmed);
  };

  const cancel = () => {
    setValue(subtask.title);
    setEditing(false);
  };

  return (
    <li className="group flex h-10 items-center gap-2.5 rounded-md px-1.5 transition-colors duration-200 hover:bg-muted/40 focus-within:bg-muted/40">
      <Checkbox
        checked={subtask.done}
        onCheckedChange={() => onToggle(subtask.id)}
        aria-label={`Toggle ${subtask.title}`}
        className="shrink-0 border-subtle"
      />
      {editing ? (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          aria-label={`Edit ${subtask.title}`}
          autoFocus
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-1 text-sm outline-none transition-colors duration-200 focus-visible:border-input focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      ) : (
        <button
          type="button"
          onClick={startEditing}
          className={cn(
            "min-w-0 flex-1 truncate rounded-md px-1 py-1 text-left text-sm text-foreground/80 outline-none transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
            subtask.done && "text-muted-foreground line-through hover:text-muted-foreground",
          )}
        >
          {subtask.title}
        </button>
      )}
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
        onClick={() => onRemove(subtask.id)}
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
  onAdd,
  onToggle,
  onRemove,
  onEditTitle,
  onPromote,
}: {
  subtasks: Subtask[];
  onAdd: (title: string) => void;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onEditTitle: (subtaskId: string, title: string) => void;
  onPromote?: (subtaskId: string) => void;
}) {
  const active = subtasks.filter((s) => !s.done);
  const completed = subtasks.filter((s) => s.done);

  return (
    <div className="space-y-1">
      {(active.length > 0 || completed.length > 0) && (
        <ul>
          {[...active, ...completed].map((s) => (
            <DrawerSubtaskRow
              key={s.id}
              subtask={s}
              onToggle={onToggle}
              onRemove={onRemove}
              onEditTitle={onEditTitle}
              onPromote={onPromote}
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

export function SubtaskList({
  subtasks,
  onAdd,
  onToggle,
  onRemove,
  onEditTitle,
  onPromote,
  drawer = false,
}: {
  subtasks: Subtask[];
  onAdd: (title: string) => void;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
  onEditTitle: (subtaskId: string, title: string) => void;
  onPromote?: (subtaskId: string) => void;
  drawer?: boolean;
}) {
  if (drawer) {
    return (
      <DrawerSubtaskList
        subtasks={subtasks}
        onAdd={onAdd}
        onToggle={onToggle}
        onRemove={onRemove}
        onEditTitle={onEditTitle}
        onPromote={onPromote}
      />
    );
  }

  return (
    <div className="space-y-1">
      <ul className="space-y-0.5">
        {subtasks.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <Checkbox
              checked={s.done}
              onCheckedChange={() => onToggle(s.id)}
              aria-label={`Toggle ${s.title}`}
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-xs",
                s.done && "text-muted-foreground line-through",
              )}
            >
              {s.title}
            </span>
            <button
              type="button"
              onClick={() => onRemove(s.id)}
              aria-label={`Delete ${s.title}`}
              className="text-xs text-subtle hover:text-destructive"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <QuickAdd onAdd={onAdd} placeholder="Add subtask" />
    </div>
  );
}

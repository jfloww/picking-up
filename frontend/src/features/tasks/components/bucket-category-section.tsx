"use client";

import { Plus } from "lucide-react";

import type { Task } from "../types";
import { BucketItemRow } from "./bucket-item-row";
import { QuickAdd } from "./quick-add";

export function BucketCategorySection({
  category,
  active,
  completed,
  onToggle,
  onSelect,
  onDelete,
  onAddItem,
}: {
  category: string;
  active: Task[];
  completed: Task[];
  onToggle: (taskId: string) => void;
  onSelect: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onAddItem: (title: string) => void;
}) {
  const total = active.length + completed.length;

  return (
    <section className="space-y-2 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">
          {category}
        </h3>
        <span className="text-[11px] font-medium text-subtle">
          {total} {total === 1 ? "item" : "items"}
        </span>
      </div>
      <ul>
        {[...active, ...completed].map((task) => (
          <BucketItemRow
            key={task.id}
            task={task}
            onToggle={() => onToggle(task.id)}
            onSelect={() => onSelect(task.id)}
            onDelete={() => onDelete(task.id)}
          />
        ))}
      </ul>
      <div className="group flex h-10 items-center gap-2.5 rounded-md px-1.5 text-foreground/70 transition-colors duration-200 hover:bg-muted/40 focus-within:bg-muted/40">
        <Plus
          className="size-3.5 shrink-0 transition-colors duration-200 group-hover:text-amber group-focus-within:text-amber"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <QuickAdd onAdd={onAddItem} placeholder="Add item" ariaLabel={`Add item to ${category}`} />
        </div>
      </div>
    </section>
  );
}

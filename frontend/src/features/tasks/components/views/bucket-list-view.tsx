"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";

import { groupBucketTasks } from "../../lib/categories";
import { useTasks } from "../../store";
import { BucketCategorySection } from "../bucket-category-section";
import { TaskDetailDrawer } from "../task-detail-drawer";
import { taskItemHandlers } from "../task-item";
import type { CalendarViewProps } from "./weekly-view";

// anchor/onAnchorChange/onDrillDown are part of CalendarViewProps (every
// view in VIEW_COMPONENTS shares that shape) but a bucket list has no
// anchor date to page through, so this view simply doesn't use them.
export function BucketListView(_props: CalendarViewProps) {
  const actions = useTasks();
  const { tasks } = actions;
  const groups = groupBucketTasks(tasks);
  const categories = groups.map((g) => g.category);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const [composerOpen, setComposerOpen] = useState(false);
  const [composerTitle, setComposerTitle] = useState("");
  const [composerCategory, setComposerCategory] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);

  const closeComposer = () => {
    setComposerOpen(false);
    setComposerTitle("");
    setComposerCategory("");
    setComposerError(null);
  };

  const submitComposer = () => {
    const title = composerTitle.trim();
    const category = composerCategory.trim();
    if (!title) {
      setComposerError("Title is required.");
      return;
    }
    if (!category) {
      setComposerError("Category is required.");
      return;
    }
    actions.addBucketItem(title, category);
    closeComposer();
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-2 overflow-y-auto transition-[padding-right] duration-200 ease-out",
        selectedTask && "pr-[400px]",
      )}
    >
      <p className="text-sm text-subtle">Things to do, eat, visit, or remember — no schedule needed.</p>

      {groups.length === 0 ? (
        <div className="space-y-1">
          <p className="text-sm font-medium">Your bucket list is empty</p>
          <p className="text-sm text-subtle">Add something you want to do, try, visit, or remember.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <BucketCategorySection
              key={group.category}
              category={group.category}
              active={group.active}
              completed={group.completed}
              onToggle={(taskId) => actions.toggleTask(taskId)}
              onSelect={(taskId) => setSelectedTaskId(taskId)}
              onDelete={(taskId) => actions.removeTask(taskId)}
              onAddItem={(title) => actions.addBucketItem(title, group.category)}
            />
          ))}
        </div>
      )}

      {composerOpen ? (
        <form
          className="space-y-2 rounded-md border border-input p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submitComposer();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              closeComposer();
            }
          }}
        >
          <input
            value={composerTitle}
            onChange={(e) => setComposerTitle(e.target.value)}
            placeholder="Item title"
            aria-label="Item title"
            autoFocus
            className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <input
            value={composerCategory}
            onChange={(e) => setComposerCategory(e.target.value)}
            list="bucket-list-category-suggestions"
            placeholder="Category"
            aria-label="Category"
            maxLength={60}
            className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <datalist id="bucket-list-category-suggestions">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {composerError && <p className="text-xs text-destructive">{composerError}</p>}
          {/* No visible submit button by design, but a form with more than
              one text field and no submit button suppresses a real browser's
              implicit Enter-to-submit entirely (per the HTML Standard). This
              sr-only button restores Enter-to-submit for every field without
              changing the visual design. */}
          <button type="submit" className="sr-only">
            Add item
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setComposerOpen(true)}
          className="group flex h-10 w-fit items-center gap-2.5 rounded-md px-1.5 text-foreground/70 outline-none transition-colors duration-200 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Plus
            className="size-3.5 shrink-0 transition-colors duration-200 group-hover:text-amber group-focus-visible:text-amber"
            aria-hidden
          />
          Add item
        </button>
      )}

      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          bucketCategories={categories}
          onClose={() => setSelectedTaskId(null)}
          {...taskItemHandlers(selectedTask.id, actions)}
        />
      )}
    </div>
  );
}

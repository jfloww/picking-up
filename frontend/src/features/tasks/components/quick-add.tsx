"use client";

import { PanelRightOpen, Plus } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

export function QuickAdd({
  onAdd,
  onAddAndOpen,
  placeholder = "Add task",
  ariaLabel = placeholder,
  variant = "default",
}: {
  onAdd: (title: string) => void;
  onAddAndOpen?: (title: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  variant?: "default" | "panel-footer";
}) {
  const [value, setValue] = useState("");
  const panelFooter = variant === "panel-footer";

  const addAndOpen = () => {
    const title = value.trim();
    if (!title) return;
    (onAddAndOpen ?? onAdd)(title);
    setValue("");
  };

  return (
    <form
      data-testid={panelFooter ? "quick-add-panel-footer" : undefined}
      className={cn(
        panelFooter &&
          "group flex min-h-11 items-center gap-2 text-muted-foreground transition-colors focus-within:text-brand hover:text-brand sm:min-h-8",
      )}
      onSubmit={(e) => {
        e.preventDefault();
        const title = value.trim();
        if (!title) return;
        onAdd(title);
        setValue("");
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.shiftKey) {
            e.preventDefault();
            addAndOpen();
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn(
          "w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-subtle focus-visible:border-input",
          panelFooter &&
            "min-w-0 flex-1 px-0 text-base font-medium text-foreground placeholder:text-muted-foreground focus-visible:border-transparent sm:text-sm",
        )}
      />
      {panelFooter && <Plus className="order-first size-4 shrink-0" aria-hidden />}
      {panelFooter && onAddAndOpen && (
        <button
          type="button"
          onClick={addAndOpen}
          aria-label="Add and open task details"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-muted hover:text-brand sm:size-auto sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
        >
          <PanelRightOpen className="size-4" />
        </button>
      )}
    </form>
  );
}

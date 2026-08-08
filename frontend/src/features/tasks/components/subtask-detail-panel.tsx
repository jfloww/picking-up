"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import type { Subtask } from "../types";
import { useFocusTrap, useRestoreFocusOnUnmount } from "./use-focus-trap";

// A single-line <input> clips a long title instead of showing all of it —
// exactly the "sometimes it's too long to show" problem this panel exists
// to fix. Both the title and the notes field auto-grow with this same
// technique so long text always wraps into view instead of scrolling.
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

// Rendered by TaskDetailDrawer as an absolutely-positioned sibling of its
// own <footer> — this component owns none of that positioning or the
// open/closed decision, only the sheet's own content and its slide-in.
// TaskDetailDrawer's `fixed` <aside> already establishes the containing
// block `inset-x-0 bottom-0` below needs.
export function SubtaskDetailPanel({
  subtask,
  onClose,
  onTitleChange,
  onMemoChange,
}: {
  subtask: Subtask;
  onClose: () => void;
  onTitleChange: (title: string) => void;
  onMemoChange: (memo: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [title, setTitle] = useState(subtask.title);
  const [memo, setMemo] = useState(subtask.memo ?? "");
  const panelRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const memoRef = useRef<HTMLTextAreaElement>(null);

  // Always the topmost layer while mounted, so its trap is unconditional —
  // unlike TaskDetailDrawer's, which releases its own trap while this one
  // is active. Mounting/unmounting this component (opening/closing the
  // panel) is exactly when focus should move in and later be restored, so
  // useRestoreFocusOnUnmount is tied to this component's own lifetime
  // rather than a toggling prop.
  useFocusTrap(panelRef, true);
  useRestoreFocusOnUnmount(panelRef, titleRef);

  useEffect(() => {
    setVisible(true);
  }, []);

  useEffect(() => {
    setTitle(subtask.title);
    setMemo(subtask.memo ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtask.id]);

  useEffect(() => {
    autoGrow(titleRef.current);
  }, [title]);

  useEffect(() => {
    autoGrow(memoRef.current);
  }, [memo]);

  const commitTitle = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== subtask.title) onTitleChange(trimmed);
    else setTitle(subtask.title);
  };

  const commitMemo = () => {
    if (memo !== (subtask.memo ?? "")) onMemoChange(memo);
  };

  return (
    <div
      ref={panelRef}
      data-testid="subtask-detail-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Subtask detail"
      tabIndex={-1}
      className={cn(
        "absolute inset-x-0 bottom-0 z-10 flex max-h-[70%] flex-col rounded-t-xl border-t border-border bg-card shadow-[0_-8px_24px_rgba(0,0,0,0.25)] transition-transform duration-200 ease-out",
        visible ? "translate-y-0" : "translate-y-full",
      )}
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-5">
        <span className="text-[11px] font-semibold tracking-[0.14em] text-subtle uppercase">
          Subtask Detail
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close subtask detail"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        <textarea
          ref={titleRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // A title is a single logical line even once it wraps onto
              // several visual ones — Enter commits it, same as the old
              // single-line <input>, instead of inserting a newline.
              e.preventDefault();
              commitTitle();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              // Stop this from bubbling to the drawer's document-level
              // Escape handler too — that handler would (redundantly but
              // harmlessly) also close this panel, since it's now the
              // innermost layer in its Escape ladder. Stopping propagation
              // keeps this local cancel-the-title-edit action fully
              // predictable and independent of that outer handler.
              e.stopPropagation();
              setTitle(subtask.title);
            }
          }}
          rows={1}
          aria-label="Subtask title"
          className="w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-1 py-1 text-base font-semibold leading-snug outline-none transition-colors duration-200 focus-visible:border-input focus-visible:ring-2 focus-visible:ring-ring/50"
        />
        <textarea
          ref={memoRef}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          onBlur={commitMemo}
          placeholder="Notes for this subtask…"
          rows={3}
          aria-label="Subtask notes"
          className="w-full resize-none overflow-hidden rounded-lg border border-input bg-muted/30 p-3 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>
    </div>
  );
}

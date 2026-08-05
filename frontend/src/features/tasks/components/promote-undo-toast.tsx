"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export function PromoteUndoToast({
  title,
  onUndo,
  onDismiss,
}: {
  title: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const undoButtonRef = useRef<HTMLButtonElement>(null);

  // Runs once per mount, not on every re-render: the parent remounts this
  // component (via a `key` on the promoted task's id — see TaskDetailDrawer)
  // each time a new promotion happens, so a mount-only timer is exactly "6
  // seconds after this toast appeared." Including onDismiss/onUndo in the
  // deps array would restart the timer on every unrelated parent re-render
  // instead (e.g. the user typing elsewhere in the drawer), since inline
  // arrow functions are a new reference every render.
  useEffect(() => {
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The promoted subtask's row (and the button that had focus) is removed
  // from the DOM the instant this toast mounts, dropping focus to <body>.
  // Move it to Undo so a keyboard user lands on the only recovery affordance
  // without having to tab through the rest of the page first.
  useEffect(() => {
    undoButtonRef.current?.focus();
  }, []);

  // Rendered via a portal so it always attaches to document.body: the
  // caller (TaskDetailDrawer) sits inside an <aside> that carries a
  // translate-x-* transform for its slide animation, and a transformed
  // ancestor becomes the containing block for `position: fixed` — which
  // would otherwise cramp this toast into the drawer panel's width instead
  // of the full viewport.
  return createPortal(
    <div
      role="status"
      className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
    >
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-lg">
        <span className="text-foreground">Moved &ldquo;{title}&rdquo; out as its own task.</span>
        <button
          ref={undoButtonRef}
          type="button"
          onClick={onUndo}
          className="font-medium text-brand hover:underline"
        >
          Undo
        </button>
      </div>
    </div>,
    document.body,
  );
}

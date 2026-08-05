"use client";

import { useEffect } from "react";

export function PromoteUndoToast({
  title,
  onUndo,
  onDismiss,
}: {
  title: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
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

  return (
    <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-lg">
        <span className="text-foreground">Moved &ldquo;{title}&rdquo; out as its own task.</span>
        <button type="button" onClick={onUndo} className="font-medium text-brand hover:underline">
          Undo
        </button>
      </div>
    </div>
  );
}

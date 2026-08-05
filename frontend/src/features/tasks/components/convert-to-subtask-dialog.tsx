"use client";

import { useEffect } from "react";

export function ConvertToSubtaskDialog({
  sourceTitle,
  targetTitle,
  lostFields,
  onConfirm,
  onCancel,
}: {
  sourceTitle: string;
  targetTitle: string;
  lostFields: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-labelledby="convert-to-subtask-title"
        className="w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="convert-to-subtask-title" className="text-sm font-semibold text-foreground">
          Make &ldquo;{sourceTitle}&rdquo; a subtask of &ldquo;{targetTitle}&rdquo;?
        </h2>
        <p className="mt-2 text-xs text-muted-foreground">This will lose: {lostFields.join(", ")}.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { Archive, ArchiveRestore, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useFocusTrap,
  useRestoreFocusOnUnmount,
} from "@/features/tasks/components/use-focus-trap";
import { cn } from "@/lib/utils";

import { MAX_FOCUS_AREAS, type FocusArea, type FocusSettings } from "../types";

function moveActiveArea(areas: FocusArea[], id: string, direction: -1 | 1): FocusArea[] {
  const activeIndexes = areas
    .map((area, index) => ({ area, index }))
    .filter(({ area }) => !area.archived);
  const position = activeIndexes.findIndex(({ area }) => area.id === id);
  const target = activeIndexes[position + direction];
  const current = activeIndexes[position];
  if (!current || !target) return areas;

  const next = [...areas];
  [next[current.index], next[target.index]] = [next[target.index]!, next[current.index]!];
  return next;
}

export function FocusManagerDialog({
  settings,
  saving,
  onSave,
  onCancel,
}: {
  settings: FocusSettings;
  saving: boolean;
  onSave: (settings: FocusSettings) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<FocusSettings>(() => ({
    ...settings,
    focusAreas: settings.focusAreas.map((area) => ({ ...area })),
  }));
  const [attempted, setAttempted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstTitleRef = useRef<HTMLInputElement>(null);

  useFocusTrap(dialogRef, true);
  useRestoreFocusOnUnmount(dialogRef, firstTitleRef);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, saving]);

  const activeAreas = useMemo(
    () => draft.focusAreas.filter((area) => !area.archived),
    [draft.focusAreas],
  );
  const archivedAreas = useMemo(
    () => draft.focusAreas.filter((area) => area.archived),
    [draft.focusAreas],
  );
  const valid = draft.focusAreas.every(
    (area) => area.title.trim().length > 0 && area.description.trim().length <= 300,
  );

  function updateArea(id: string, patch: Partial<FocusArea>) {
    setDraft((current) => ({
      ...current,
      focusAreas: current.focusAreas.map((area) =>
        area.id === id ? { ...area, ...patch } : area,
      ),
    }));
  }

  function addArea() {
    if (draft.focusAreas.length >= MAX_FOCUS_AREAS) return;
    const area: FocusArea = {
      id: crypto.randomUUID(),
      title: "",
      description: "",
      archived: false,
    };
    setDraft((current) => ({
      focusAreas: [...current.focusAreas, area],
      activeFocusId: current.activeFocusId ?? area.id,
    }));
    queueMicrotask(() => {
      const inputs = dialogRef.current?.querySelectorAll<HTMLInputElement>("[data-focus-title]");
      inputs?.[inputs.length - 1]?.focus();
    });
  }

  function archiveArea(id: string) {
    setDraft((current) => {
      const focusAreas = current.focusAreas.map((area) =>
        area.id === id ? { ...area, archived: true } : area,
      );
      const nextActive = focusAreas.find((area) => !area.archived)?.id ?? null;
      return {
        focusAreas,
        activeFocusId: current.activeFocusId === id ? nextActive : current.activeFocusId,
      };
    });
  }

  async function submit() {
    setAttempted(true);
    if (!valid) return;
    const normalized = {
      focusAreas: draft.focusAreas.map((area) => ({
        ...area,
        title: area.title.trim(),
        description: area.description.trim(),
      })),
      activeFocusId:
        draft.focusAreas.some(
          (area) => area.id === draft.activeFocusId && !area.archived,
        )
          ? draft.activeFocusId
          : activeAreas[0]?.id ?? null,
    };
    await onSave(normalized);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="focus-manager-title"
        className="flex max-h-[88dvh] w-full max-w-2xl flex-col rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl"
        tabIndex={-1}
      >
        <header className="flex shrink-0 items-start justify-between border-b border-border px-5 py-4 sm:px-6">
          <div>
            <h2 id="focus-manager-title" className="text-base font-bold tracking-tight">
              Manage focus areas
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Keep several long-term goals, then choose one to headline every planner view.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close focus manager"
            onClick={onCancel}
            disabled={saving}
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 sm:size-9"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          <div className="space-y-3">
            {activeAreas.map((area, index) => {
              const current = draft.activeFocusId === area.id;
              return (
                <section key={area.id} className="rounded-xl border border-border bg-background p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <label htmlFor={`focus-title-${area.id}`} className="sr-only">
                          Focus title {index + 1}
                        </label>
                        <Input
                          ref={index === 0 ? firstTitleRef : undefined}
                          id={`focus-title-${area.id}`}
                          data-focus-title
                          value={area.title}
                          maxLength={120}
                          aria-invalid={attempted && !area.title.trim()}
                          placeholder="Focus title"
                          onChange={(event) => updateArea(area.id, { title: event.target.value })}
                          className="h-10 font-semibold"
                        />
                        {current && (
                          <span className="shrink-0 rounded-full border border-brand/30 bg-brand/10 px-2 py-1 text-[10px] font-semibold tracking-wider text-brand uppercase">
                            Current
                          </span>
                        )}
                      </div>
                      <label htmlFor={`focus-description-${area.id}`} className="sr-only">
                        Focus description {index + 1}
                      </label>
                      <textarea
                        id={`focus-description-${area.id}`}
                        value={area.description}
                        maxLength={300}
                        rows={2}
                        placeholder="What does progress on this focus look like?"
                        onChange={(event) =>
                          updateArea(area.id, { description: event.target.value })
                        }
                        className="w-full resize-none rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      />
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        aria-label={`Move ${area.title || `focus ${index + 1}`} up`}
                        disabled={index === 0}
                        onClick={() =>
                          setDraft((currentDraft) => ({
                            ...currentDraft,
                            focusAreas: moveActiveArea(currentDraft.focusAreas, area.id, -1),
                          }))
                        }
                        className="flex size-8 items-center justify-center rounded-md text-subtle hover:bg-muted hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronUp className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${area.title || `focus ${index + 1}`} down`}
                        disabled={index === activeAreas.length - 1}
                        onClick={() =>
                          setDraft((currentDraft) => ({
                            ...currentDraft,
                            focusAreas: moveActiveArea(currentDraft.focusAreas, area.id, 1),
                          }))
                        }
                        className="flex size-8 items-center justify-center rounded-md text-subtle hover:bg-muted hover:text-foreground disabled:opacity-30"
                      >
                        <ChevronDown className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Archive ${area.title || `focus ${index + 1}`}`}
                        onClick={() => archiveArea(area.id)}
                        className="flex size-8 items-center justify-center rounded-md text-subtle hover:bg-muted hover:text-foreground"
                      >
                        <Archive className="size-4" />
                      </button>
                    </div>
                  </div>
                  {!current && area.title.trim() && (
                    <button
                      type="button"
                      onClick={() => setDraft((value) => ({ ...value, activeFocusId: area.id }))}
                      className="mt-2 min-h-9 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      Set as current
                    </button>
                  )}
                </section>
              );
            })}
          </div>

          {activeAreas.length === 0 && (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
              <p className="text-sm font-medium">No active focus areas yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add the long-term goal you want to see above your planner.
              </p>
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={addArea}
            disabled={draft.focusAreas.length >= MAX_FOCUS_AREAS}
            className="mt-3 h-11 w-full border-dashed sm:h-9"
          >
            <Plus className="size-4" />
            Add focus area
          </Button>
          <p className="mt-1 text-right text-[11px] text-subtle">
            {draft.focusAreas.length} / {MAX_FOCUS_AREAS}
          </p>

          {archivedAreas.length > 0 && (
            <section className="mt-5 border-t border-border pt-4">
              <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                Archived
              </h3>
              <div className="mt-2 space-y-1">
                {archivedAreas.map((area) => (
                  <div key={area.id} className="flex min-h-11 items-center gap-3 rounded-lg px-2 hover:bg-muted/50">
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                      {area.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateArea(area.id, { archived: false })}
                      className="flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <ArchiveRestore className="size-3.5" />
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {attempted && !valid && (
            <p role="alert" className="mt-3 text-xs text-destructive">
              Every focus area needs a title.
            </p>
          )}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-4 sm:px-6">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving} className="h-11 sm:h-9">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={saving || !valid}
            className={cn("h-11 px-4 sm:h-9", saving && "cursor-wait")}
          >
            {saving ? "Saving…" : "Save focus areas"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

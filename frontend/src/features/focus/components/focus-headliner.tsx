"use client";

import { Check, ChevronDown, Settings2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { createApiFocusRepository, type FocusRepository } from "../data/focus-repository";
import { EMPTY_FOCUS_SETTINGS, type FocusSettings } from "../types";
import { FocusManagerDialog } from "./focus-manager-dialog";

export function FocusHeadliner({ repository }: { repository?: FocusRepository }) {
  const repo = useMemo(() => repository ?? createApiFocusRepository(), [repository]);
  const [settings, setSettings] = useState<FocusSettings>(EMPTY_FOCUS_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const menuRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;
    repo
      .load()
      .then((value) => {
        if (!active) return;
        setSettings(value);
        setSyncError(null);
      })
      .catch(() => {
        if (!active) return;
        setSyncError("Focus areas couldn't load.");
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [repo]);

  useEffect(() => {
    if (!menuOpen) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const activeAreas = settings.focusAreas.filter((area) => !area.archived);
  const activeFocus =
    activeAreas.find((area) => area.id === settings.activeFocusId) ?? activeAreas[0];
  const activePosition = activeFocus
    ? activeAreas.findIndex((area) => area.id === activeFocus.id) + 1
    : 0;
  const hasMultipleActiveAreas = activeAreas.length > 1;

  async function persist(next: FocusSettings): Promise<boolean> {
    const previous = settings;
    setSettings(next);
    setSaving(true);
    setSyncError(null);
    try {
      setSettings(await repo.save(next));
      return true;
    } catch {
      setSettings(previous);
      setSyncError("Focus areas didn't save. Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function selectFocus(id: string) {
    setMenuOpen(false);
    await persist({ ...settings, activeFocusId: id });
  }

  if (!loaded) {
    return (
      <section
        aria-label="Loading current focus"
        aria-busy="true"
        className="mx-4 mt-3 h-20 shrink-0 animate-pulse rounded-xl border border-border bg-card sm:mx-0 sm:h-16"
      />
    );
  }

  return (
    <>
      <section
        ref={menuRef}
        data-testid="focus-headliner"
        aria-label="Current focus shared across all planner views"
        className="relative mx-4 mt-3 flex min-h-20 shrink-0 items-center rounded-xl border border-border bg-card px-3 py-2.5 sm:mx-0 sm:h-16 sm:min-h-0 sm:px-6 sm:py-2"
      >
        <div className="flex min-w-0 flex-1 items-stretch border-l-2 border-brand pl-3 pr-28 sm:pr-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3 sm:justify-start">
              <div className="flex min-w-0 items-center gap-2">
                <p className="text-[11px] font-semibold tracking-[0.12em] text-brand uppercase">
                  Current Focus
                </p>
                {activeFocus && hasMultipleActiveAreas && (
                  <span className="hidden rounded-full border border-border px-2 text-[11px] font-medium text-subtle sm:inline-flex">
                    {activePosition} of {activeAreas.length}
                  </span>
                )}
              </div>

              {activeFocus && hasMultipleActiveAreas && (
                <div className="absolute top-1/2 right-3 -translate-y-1/2 sm:hidden">
                  <button
                    type="button"
                    aria-label={`Switch focus (${activePosition} of ${activeAreas.length})`}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((open) => !open)}
                    disabled={saving}
                    className="flex h-11 shrink-0 items-center gap-1 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    Switch
                    <ChevronDown className="size-3.5" />
                  </button>
                </div>
              )}

              {activeFocus && !hasMultipleActiveAreas && (
                <button
                  type="button"
                  onClick={() => setManagerOpen(true)}
                  disabled={saving}
                  className="absolute top-1/2 right-3 flex h-11 -translate-y-1/2 shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 sm:hidden"
                >
                  <Settings2 className="size-3.5" />
                  Edit focus
                </button>
              )}
            </div>

            {activeFocus ? (
              <div className="min-w-0 lg:flex lg:items-baseline lg:gap-4">
                <h2 title={activeFocus.title} className="mt-1 truncate text-base font-semibold tracking-tight sm:mt-0 lg:max-w-[50%] lg:shrink-0 lg:text-lg">
                  {activeFocus.title}
                </h2>
                {activeFocus.description ? (
                  <p title={activeFocus.description} className="hidden min-w-0 flex-1 truncate text-sm text-muted-foreground lg:block">
                    {activeFocus.description}
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => setManagerOpen(true)}
                    className="hidden text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 lg:block"
                  >
                    Add note
                  </button>
                )}
              </div>
            ) : (
              <div className="min-w-0">
                <h2 className="mt-1 truncate text-base font-semibold tracking-tight sm:mt-0 sm:text-lg">
                  Choose what deserves your attention
                </h2>
                <p className="hidden truncate text-xs text-muted-foreground lg:block">
                  Add a long-term focus to carry across every planner view.
                </p>
              </div>
            )}
          </div>

          <div className="ml-4 hidden shrink-0 items-center gap-1 sm:flex">
            {activeFocus && hasMultipleActiveAreas ? (
              <div className="relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((open) => !open)}
                  disabled={saving}
                  className="flex h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  Switch focus
                  <ChevronDown className="size-3.5" />
                </button>
              </div>
            ) : activeFocus ? (
              <button
                type="button"
                onClick={() => setManagerOpen(true)}
                disabled={saving}
                className="flex h-11 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <Settings2 className="size-3.5" />
                Edit focus
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setManagerOpen(true)}
                className="h-11 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Add focus
              </button>
            )}
          </div>
        </div>

        {!activeFocus && (
          <button
            type="button"
            onClick={() => setManagerOpen(true)}
            className="absolute top-1/2 right-3 flex h-11 -translate-y-1/2 shrink-0 items-center rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 sm:hidden"
          >
            Add focus
          </button>
        )}

        {menuOpen && activeFocus && hasMultipleActiveAreas && (
          <FocusMenu
            areas={activeAreas}
            activeId={activeFocus.id}
            onSelect={selectFocus}
            onManage={() => {
              setMenuOpen(false);
              setManagerOpen(true);
            }}
            align="right"
          />
        )}

        {(syncError || saving) && (
          <p
            role={syncError ? "alert" : "status"}
            className={cn(
              "absolute right-3 bottom-1 text-[10px] sm:right-6",
              syncError ? "text-destructive" : "text-subtle",
            )}
          >
            {syncError ?? "Saving…"}
          </p>
        )}
      </section>

      {managerOpen && (
        <FocusManagerDialog
          settings={settings}
          saving={saving}
          onCancel={() => setManagerOpen(false)}
          onSave={async (next) => {
            const saved = await persist(next);
            if (saved) setManagerOpen(false);
            return saved;
          }}
        />
      )}
    </>
  );
}

function FocusMenu({
  areas,
  activeId,
  onSelect,
  onManage,
  align,
}: {
  areas: FocusSettings["focusAreas"];
  activeId: string;
  onSelect: (id: string) => void;
  onManage: () => void;
  align: "left" | "right";
}) {
  return (
    <div
      role="menu"
      aria-label="Select focus area"
      className={cn(
        "absolute top-[calc(100%+6px)] z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card shadow-2xl",
        align === "right" ? "right-0 sm:right-6" : "left-0 sm:left-6",
      )}
    >
      <div className="p-1.5">
        {areas.map((area) => {
          const selected = area.id === activeId;
          return (
            <button
              key={area.id}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              onClick={() => onSelect(area.id)}
              className={cn(
                "flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm font-medium hover:bg-muted",
                selected ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="truncate">{area.title}</span>
              {selected && <Check className="size-4 shrink-0 text-brand" />}
            </button>
          );
        })}
      </div>
      <div className="border-t border-border p-1.5">
        <button
          type="button"
          role="menuitem"
          onClick={onManage}
          className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Settings2 className="size-3.5" />
          Manage focus areas
        </button>
      </div>
    </div>
  );
}

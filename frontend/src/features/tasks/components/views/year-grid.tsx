"use client";

import { monthKeys, monthName } from "../../lib/dates";
import type { Scope } from "../../types";
import { PeriodCell } from "../period-cell";
import { ScopeTasks } from "../scope-tasks";

export function YearGrid({
  year,
  focusedMonth,
  onFocusMonth,
  sideLabel,
  sideScope,
}: {
  year: string;
  focusedMonth?: string;
  onFocusMonth?: (monthKey: string) => void;
  sideLabel: string;
  sideScope: Scope;
}) {
  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">{year}</h2>
      <div className="grid gap-1 lg:grid-cols-[1fr_16rem]">
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4">
          {monthKeys(year).map((month) => {
            const name = monthName(month);
            const preview = (
              <ScopeTasks scope={{ kind: "month", month }} compact />
            );
            if (!focusedMonth) {
              return (
                <div
                  key={month}
                  className="min-h-24 rounded-md border border-border p-1.5"
                >
                  <div className="mb-1 text-xs font-semibold">{name}</div>
                  {preview}
                </div>
              );
            }
            return (
              <PeriodCell
                key={month}
                focused={month === focusedMonth}
                onFocus={() => onFocusMonth?.(month)}
                aria-label={`Focus ${name}`}
                label={name}
                className="min-h-24 p-1.5"
              >
                {preview}
              </PeriodCell>
            );
          })}
        </div>
        <div className="rounded-md bg-muted/40 p-2">
          <div className="mb-1 text-xs font-semibold">{sideLabel}</div>
          <ScopeTasks scope={sideScope} quickAdd />
        </div>
      </div>
    </div>
  );
}

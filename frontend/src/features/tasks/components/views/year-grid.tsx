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
    <div className="grid h-full min-h-0 gap-1 lg:grid-cols-[1fr_16rem]">
      <div className="min-h-0 overflow-y-auto">
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4">
          {monthKeys(year).map((month) => {
            const name = monthName(month);
            const preview = <ScopeTasks scope={{ kind: "month", month }} compact />;
            if (!focusedMonth) {
              return (
                <div
                  key={month}
                  className="flex h-24 flex-col rounded-md border border-border p-1.5"
                >
                  <div className="mb-1 shrink-0 text-xs font-semibold">
                    {name}
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto">{preview}</div>
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
                className="flex h-24 flex-col p-1.5"
                contentClassName="min-h-0 flex-1 overflow-y-auto"
              >
                {preview}
              </PeriodCell>
            );
          })}
        </div>
      </div>
      <div className="flex min-h-0 flex-col rounded-md bg-muted/40 p-2">
        <div className="mb-1 shrink-0 text-xs font-semibold">{sideLabel}</div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ScopeTasks scope={sideScope} quickAdd />
        </div>
      </div>
    </div>
  );
}

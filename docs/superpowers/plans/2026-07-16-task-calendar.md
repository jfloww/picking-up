# Task Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the multi-scale to-do calendar (Daily/Weekly/Monthly/Yearly views with "context + focused present" fading and automatic rollover) at `/app`, persisted in localStorage behind a swappable repository.

**Architecture:** Pure date/rollover logic in `lib/`, a `TaskRepository` interface with a localStorage implementation in `data/`, React context+reducer store in `store.tsx`, and four view components composed from shared primitives (`PeriodCell`, `ScopeTasks`, `TaskItem`, `QuickAdd`). Spec: `docs/superpowers/specs/2026-07-16-task-calendar-design.md`.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4 (design tokens already in `globals.css`), Base UI components in `src/components/ui/`, Vitest + @testing-library/react + jsdom (added in Task 1).

## Global Constraints

- All commands run inside `frontend/` (`cd frontend` first).
- Weeks start **Sunday**. Date keys are strings: day `"2026-07-16"`, week = its Sunday's date key, month `"2026-07"`, year `"2026"`. ISO string comparison (`<`, `===`) is the ordering primitive — never compare `Date` objects across the codebase.
- Do NOT use the legacy CSS classes in `globals.css` (`.app-shell`, `.panel`, `.eyebrow`, etc.) in new code — Tailwind utility classes with existing tokens (`bg-card`, `text-subtle`, `text-brand`, `ring-ring`, `bg-muted`, …) only.
- New code lives under `frontend/src/features/tasks/`. Tests are colocated (`*.test.ts` / `*.test.tsx` next to the file under test).
- Interactive components need `"use client"` at the top of the file.
- No hardcoded env-style config; the only constant is the localStorage key `"picking-up.tasks.v1"` in `data/repository.ts`.
- Commit style: conventional commits (`feat:`, `test:`, `refactor:`), each ending with the line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- lucide-react icons used: `CheckIcon` (already used), `RotateCw`, `ChevronLeft`, `ChevronRight`.

---

### Task 1: Test infrastructure + date utilities

**Files:**
- Create: `frontend/vitest.config.ts`
- Modify: `frontend/package.json` (add `test` scripts; devDependencies via npm install)
- Create: `frontend/src/features/tasks/lib/dates.ts`
- Test: `frontend/src/features/tasks/lib/dates.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all exported from `lib/dates.ts`, all date keys are strings as defined in Global Constraints):
  - `todayKey(): string`
  - `addDays(dateKey: string, n: number): string`
  - `dayOfMonth(dateKey: string): number`
  - `weekStartOf(dateKey: string): string` — the Sunday of that date's week
  - `weekDates(weekStart: string): string[]` — 7 consecutive date keys
  - `monthKeyOf(dateKey: string): string`
  - `yearOf(dateKey: string): string`
  - `nextMonthKey(monthKey: string): string`
  - `prevMonthKey(monthKey: string): string`
  - `monthKeys(year: string): string[]` — 12 month keys
  - `monthGrid(monthKey: string): (string | null)[][]` — rows of 7 (Su–Sa), `null` for cells outside the month
  - `monthLabel(monthKey: string): string` — e.g. `"July 2026"`
  - `monthName(monthKey: string): string` — e.g. `"July"`

- [ ] **Step 1: Install test dependencies**

```bash
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react
```

- [ ] **Step 2: Create vitest config and test scripts**

`frontend/vitest.config.ts`:

```ts
import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
```

In `frontend/package.json` scripts, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Write the failing tests**

`frontend/src/features/tasks/lib/dates.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  addDays,
  dayOfMonth,
  monthGrid,
  monthKeyOf,
  monthKeys,
  monthLabel,
  monthName,
  nextMonthKey,
  prevMonthKey,
  todayKey,
  weekDates,
  weekStartOf,
  yearOf,
} from "./dates";

describe("dates", () => {
  it("todayKey returns YYYY-MM-DD", () => {
    expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("addDays crosses month and year boundaries", () => {
    expect(addDays("2026-07-16", 1)).toBe("2026-07-17");
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-07-01", -1)).toBe("2026-06-30");
  });

  it("dayOfMonth extracts the day number", () => {
    expect(dayOfMonth("2026-07-05")).toBe(5);
    expect(dayOfMonth("2026-07-16")).toBe(16);
  });

  it("weekStartOf returns the Sunday of the week", () => {
    expect(weekStartOf("2026-07-16")).toBe("2026-07-12"); // Thursday -> Sunday
    expect(weekStartOf("2026-07-12")).toBe("2026-07-12"); // Sunday is its own start
    expect(weekStartOf("2026-07-01")).toBe("2026-06-28"); // week spans two months
  });

  it("weekDates returns 7 consecutive days", () => {
    expect(weekDates("2026-07-12")).toEqual([
      "2026-07-12",
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
    ]);
  });

  it("monthKeyOf / yearOf slice the key", () => {
    expect(monthKeyOf("2026-07-16")).toBe("2026-07");
    expect(yearOf("2026-07-16")).toBe("2026");
  });

  it("nextMonthKey and prevMonthKey handle year boundaries", () => {
    expect(nextMonthKey("2026-07")).toBe("2026-08");
    expect(nextMonthKey("2026-12")).toBe("2027-01");
    expect(prevMonthKey("2026-07")).toBe("2026-06");
    expect(prevMonthKey("2026-01")).toBe("2025-12");
  });

  it("monthKeys returns 12 padded keys", () => {
    const keys = monthKeys("2026");
    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe("2026-01");
    expect(keys[11]).toBe("2026-12");
  });

  it("monthGrid builds Su-Sa rows with null padding", () => {
    const grid = monthGrid("2026-07"); // 2026-07-01 is a Wednesday
    expect(grid).toHaveLength(5);
    expect(grid[0]).toEqual([
      null,
      null,
      null,
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
    ]);
    expect(grid[2][0]).toBe("2026-07-12");
    expect(grid[4]).toEqual([
      "2026-07-26",
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      null,
    ]);
    for (const row of grid) expect(row).toHaveLength(7);
  });

  it("monthLabel and monthName format for display", () => {
    expect(monthLabel("2026-07")).toBe("July 2026");
    expect(monthName("2026-01")).toBe("January");
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/lib/dates.test.ts`
Expected: FAIL — cannot resolve `./dates`.

- [ ] **Step 5: Implement `lib/dates.ts`**

```ts
function parse(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function todayKey(): string {
  return toKey(new Date());
}

export function addDays(dateKey: string, n: number): string {
  const d = parse(dateKey);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export function dayOfMonth(dateKey: string): number {
  return Number(dateKey.slice(8));
}

export function weekStartOf(dateKey: string): string {
  return addDays(dateKey, -parse(dateKey).getDay());
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function yearOf(dateKey: string): string {
  return dateKey.slice(0, 4);
}

export function nextMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function prevMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function monthKeys(year: string): string[] {
  return Array.from(
    { length: 12 },
    (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`,
  );
}

export function monthGrid(monthKey: string): (string | null)[][] {
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const rows: (string | null)[][] = [];
  let row: (string | null)[] = Array(new Date(y, m - 1, 1).getDay()).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    row.push(toKey(new Date(y, m - 1, day)));
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length > 0) {
    rows.push([...row, ...Array(7 - row.length).fill(null)]);
  }
  return rows;
}

export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function monthName(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/lib/dates.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/features/tasks/lib/dates.ts src/features/tasks/lib/dates.test.ts
git commit -m "feat: add task-calendar date utilities with vitest setup"
```

---

### Task 2: Task types + rollover logic

**Files:**
- Create: `frontend/src/features/tasks/types.ts`
- Create: `frontend/src/features/tasks/lib/rollover.ts`
- Test: `frontend/src/features/tasks/lib/rollover.test.ts`

**Interfaces:**
- Consumes: `weekStartOf`, `monthKeyOf` from `lib/dates.ts`.
- Produces:
  - `types.ts`: `type Scope`, `interface Task`, `scopeKey(scope: Scope): string`
  - `lib/rollover.ts`: `rolloverTasks(tasks: Task[], today: string): Task[]` — pure; returns the *same object reference* for tasks that didn't move.

- [ ] **Step 1: Write `types.ts`** (types have no behavior to test on their own)

```ts
export type Scope =
  | { kind: "day"; date: string }
  | { kind: "week"; weekStart: string }
  | { kind: "month"; month: string }
  | { kind: "year"; year: string };

export interface Task {
  id: string;
  title: string;
  memo?: string;
  done: boolean;
  scope: Scope;
  rolledFrom?: Scope;
  createdAt: string;
  completedAt?: string;
}

export function scopeKey(scope: Scope): string {
  switch (scope.kind) {
    case "day":
      return `day:${scope.date}`;
    case "week":
      return `week:${scope.weekStart}`;
    case "month":
      return `month:${scope.month}`;
    case "year":
      return `year:${scope.year}`;
  }
}
```

- [ ] **Step 2: Write the failing rollover tests**

`frontend/src/features/tasks/lib/rollover.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { Task } from "../types";
import { rolloverTasks } from "./rollover";

const TODAY = "2026-07-16"; // Thursday; current week starts 2026-07-12

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "t1",
    title: "task",
    done: false,
    scope: { kind: "day", date: TODAY },
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("rolloverTasks", () => {
  it("moves an unfinished past day task into its week's weekly cell", () => {
    const task = makeTask({ scope: { kind: "day", date: "2026-07-14" } });
    const [rolled] = rolloverTasks([task], TODAY);
    expect(rolled.scope).toEqual({ kind: "week", weekStart: "2026-07-12" });
    expect(rolled.rolledFrom).toEqual({ kind: "day", date: "2026-07-14" });
  });

  it("keeps rolling a day task from an older week into the current week", () => {
    const task = makeTask({ scope: { kind: "day", date: "2026-07-03" } });
    const [rolled] = rolloverTasks([task], TODAY);
    expect(rolled.scope).toEqual({ kind: "week", weekStart: "2026-07-12" });
    expect(rolled.rolledFrom).toEqual({ kind: "day", date: "2026-07-03" });
  });

  it("moves an unfinished past week task into the current week", () => {
    const task = makeTask({ scope: { kind: "week", weekStart: "2026-07-05" } });
    const [rolled] = rolloverTasks([task], TODAY);
    expect(rolled.scope).toEqual({ kind: "week", weekStart: "2026-07-12" });
  });

  it("preserves the original rolledFrom across repeated rolls", () => {
    const task = makeTask({
      scope: { kind: "week", weekStart: "2026-07-05" },
      rolledFrom: { kind: "day", date: "2026-07-01" },
    });
    const [rolled] = rolloverTasks([task], TODAY);
    expect(rolled.rolledFrom).toEqual({ kind: "day", date: "2026-07-01" });
  });

  it("moves an unfinished past month task into the current month", () => {
    const task = makeTask({ scope: { kind: "month", month: "2026-05" } });
    const [rolled] = rolloverTasks([task], TODAY);
    expect(rolled.scope).toEqual({ kind: "month", month: "2026-07" });
  });

  it("never touches done, current, future, or year tasks", () => {
    const done = makeTask({
      id: "done",
      done: true,
      scope: { kind: "day", date: "2026-07-01" },
    });
    const today = makeTask({ id: "today" });
    const future = makeTask({
      id: "future",
      scope: { kind: "day", date: "2026-07-20" },
    });
    const year = makeTask({ id: "year", scope: { kind: "year", year: "2025" } });
    const input = [done, today, future, year];
    const result = rolloverTasks(input, TODAY);
    // same references — nothing moved
    for (let i = 0; i < input.length; i++) expect(result[i]).toBe(input[i]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/lib/rollover.test.ts`
Expected: FAIL — cannot resolve `./rollover`.

- [ ] **Step 4: Implement `lib/rollover.ts`**

Repeated rolls ("into the next week" until caught up) collapse to a single jump
to the current week/month, since intermediate weeks are already in the past.

```ts
import type { Task } from "../types";
import { monthKeyOf, weekStartOf } from "./dates";

export function rolloverTasks(tasks: Task[], today: string): Task[] {
  const currentWeek = weekStartOf(today);
  const currentMonth = monthKeyOf(today);

  return tasks.map((task) => {
    if (task.done) return task;

    let scope = task.scope;
    if (scope.kind === "day" && scope.date < today) {
      scope = { kind: "week", weekStart: weekStartOf(scope.date) };
    }
    if (scope.kind === "week" && scope.weekStart < currentWeek) {
      scope = { kind: "week", weekStart: currentWeek };
    }
    if (scope.kind === "month" && scope.month < currentMonth) {
      scope = { kind: "month", month: currentMonth };
    }
    if (scope === task.scope) return task;

    return { ...task, scope, rolledFrom: task.rolledFrom ?? task.scope };
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/lib/rollover.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/types.ts src/features/tasks/lib/rollover.ts src/features/tasks/lib/rollover.test.ts
git commit -m "feat: add task types and rollover logic"
```

---

### Task 3: Task repository (localStorage)

**Files:**
- Create: `frontend/src/features/tasks/data/repository.ts`
- Test: `frontend/src/features/tasks/data/repository.test.ts`

**Interfaces:**
- Consumes: `Task` from `types.ts`.
- Produces:
  - `interface TaskRepository { list(): Promise<Task[]>; create(task: Task): Promise<void>; update(task: Task): Promise<void>; remove(id: string): Promise<void> }`
  - `type TaskStorage = Pick<Storage, "getItem" | "setItem">`
  - `createLocalStorageRepository(storage?: TaskStorage): TaskRepository` — defaults to `window.localStorage`, accessed lazily inside methods (never at factory-call time, so the factory is SSR-safe).

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/tasks/data/repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { Task } from "../types";
import { createLocalStorageRepository, type TaskStorage } from "./repository";

function fakeStorage(initial: Record<string, string> = {}): TaskStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

const task: Task = {
  id: "a",
  title: "buy milk",
  done: false,
  scope: { kind: "day", date: "2026-07-16" },
  createdAt: "2026-07-16T00:00:00.000Z",
};

describe("createLocalStorageRepository", () => {
  it("round-trips create/list/update/remove", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    await repo.create(task);
    expect(await repo.list()).toEqual([task]);

    await repo.update({ ...task, done: true });
    expect((await repo.list())[0].done).toBe(true);

    await repo.remove("a");
    expect(await repo.list()).toEqual([]);
  });

  it("returns [] for missing, corrupt, or non-array data", async () => {
    expect(
      await createLocalStorageRepository(fakeStorage()).list(),
    ).toEqual([]);
    expect(
      await createLocalStorageRepository(
        fakeStorage({ "picking-up.tasks.v1": "{not json" }),
      ).list(),
    ).toEqual([]);
    expect(
      await createLocalStorageRepository(
        fakeStorage({ "picking-up.tasks.v1": '{"a":1}' }),
      ).list(),
    ).toEqual([]);
  });

  it("filters out malformed entries but keeps valid ones", async () => {
    const repo = createLocalStorageRepository(
      fakeStorage({
        "picking-up.tasks.v1": JSON.stringify([task, { junk: true }, null]),
      }),
    );
    expect(await repo.list()).toEqual([task]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/data/repository.test.ts`
Expected: FAIL — cannot resolve `./repository`.

- [ ] **Step 3: Implement `data/repository.ts`**

```ts
import type { Task } from "../types";

const STORAGE_KEY = "picking-up.tasks.v1";

const SCOPE_KINDS = ["day", "week", "month", "year"] as const;

export type TaskStorage = Pick<Storage, "getItem" | "setItem">;

export interface TaskRepository {
  list(): Promise<Task[]>;
  create(task: Task): Promise<void>;
  update(task: Task): Promise<void>;
  remove(id: string): Promise<void>;
}

function isTask(value: unknown): value is Task {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  const scope = t.scope as Record<string, unknown> | undefined;
  return (
    typeof t.id === "string" &&
    typeof t.title === "string" &&
    typeof t.done === "boolean" &&
    typeof t.createdAt === "string" &&
    typeof scope === "object" &&
    scope !== null &&
    SCOPE_KINDS.includes(scope.kind as (typeof SCOPE_KINDS)[number])
  );
}

export function createLocalStorageRepository(
  storage?: TaskStorage,
): TaskRepository {
  // Resolved lazily so the factory can run during SSR without touching window.
  const store = () => storage ?? window.localStorage;

  const read = (): Task[] => {
    try {
      const raw = store().getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isTask);
    } catch {
      return [];
    }
  };

  const write = (tasks: Task[]) =>
    store().setItem(STORAGE_KEY, JSON.stringify(tasks));

  return {
    async list() {
      return read();
    },
    async create(task) {
      write([...read(), task]);
    },
    async update(task) {
      write(read().map((t) => (t.id === task.id ? task : t)));
    },
    async remove(id) {
      write(read().filter((t) => t.id !== id));
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/data/repository.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/data/repository.ts src/features/tasks/data/repository.test.ts
git commit -m "feat: add localStorage task repository"
```

---

### Task 4: Task store (context + reducer)

**Files:**
- Create: `frontend/src/features/tasks/store.tsx`
- Create: `frontend/src/features/tasks/test-utils.tsx`
- Test: `frontend/src/features/tasks/store.test.tsx`

**Interfaces:**
- Consumes: `Task`, `Scope` from `types.ts`; `rolloverTasks`; `todayKey`; `TaskRepository`, `createLocalStorageRepository`.
- Produces (`store.tsx`):
  - `tasksReducer(state: TasksState, action: TasksAction): TasksState` (exported for tests)
  - `TasksProvider({ repository?, children })` — loads via repository on mount, applies `rolloverTasks`, persists rolled tasks
  - `useTasks(): { loaded: boolean; tasks: Task[]; addTask(title: string, scope: Scope): void; toggleTask(id: string): void; setMemo(id: string, memo: string): void; removeTask(id: string): void }`
- Produces (`test-utils.tsx`):
  - `fakeRepository(initial?: Task[]): TaskRepository & { tasks: Task[] }`
  - `makeTask(overrides?: Partial<Task>): Task`

- [ ] **Step 1: Write `test-utils.tsx`**

```tsx
import type { TaskRepository } from "./data/repository";
import type { Task } from "./types";

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    title: "task",
    done: false,
    scope: { kind: "day", date: "2026-07-16" },
    createdAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

export function fakeRepository(
  initial: Task[] = [],
): TaskRepository & { tasks: Task[] } {
  const state = { tasks: [...initial] };
  return {
    get tasks() {
      return state.tasks;
    },
    async list() {
      return [...state.tasks];
    },
    async create(task) {
      state.tasks = [...state.tasks, task];
    },
    async update(task) {
      state.tasks = state.tasks.map((t) => (t.id === task.id ? task : t));
    },
    async remove(id) {
      state.tasks = state.tasks.filter((t) => t.id !== id);
    },
  };
}
```

- [ ] **Step 2: Write the failing tests**

`frontend/src/features/tasks/store.test.tsx`:

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { TasksProvider, tasksReducer, useTasks } from "./store";
import { fakeRepository, makeTask } from "./test-utils";
import { todayKey } from "./lib/dates";

describe("tasksReducer", () => {
  it("handles loaded/added/updated/removed", () => {
    const task = makeTask({ id: "a" });
    let state = tasksReducer(
      { loaded: false, tasks: [] },
      { type: "loaded", tasks: [task] },
    );
    expect(state).toEqual({ loaded: true, tasks: [task] });

    const other = makeTask({ id: "b" });
    state = tasksReducer(state, { type: "added", task: other });
    expect(state.tasks).toHaveLength(2);

    state = tasksReducer(state, {
      type: "updated",
      task: { ...task, done: true },
    });
    expect(state.tasks[0].done).toBe(true);

    state = tasksReducer(state, { type: "removed", id: "a" });
    expect(state.tasks.map((t) => t.id)).toEqual(["b"]);
  });
});

describe("TasksProvider", () => {
  function setup(repo = fakeRepository()) {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TasksProvider repository={repo}>{children}</TasksProvider>
    );
    return { repo, ...renderHook(() => useTasks(), { wrapper }) };
  }

  it("loads tasks, applies rollover, and persists rolled tasks", async () => {
    const stale = makeTask({
      id: "stale",
      scope: { kind: "day", date: "2020-01-01" },
    });
    const { repo, result } = setup(fakeRepository([stale]));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.tasks[0].scope.kind).toBe("week");
    await waitFor(() => expect(repo.tasks[0].scope.kind).toBe("week"));
  });

  it("addTask creates a task and persists it; blank titles are ignored", async () => {
    const { repo, result } = setup();
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.addTask("  ", { kind: "day", date: todayKey() });
      result.current.addTask("write plan", { kind: "day", date: todayKey() });
    });

    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0].title).toBe("write plan");
    await waitFor(() => expect(repo.tasks).toHaveLength(1));
  });

  it("toggleTask flips done and sets/clears completedAt", async () => {
    const task = makeTask({ id: "a", scope: { kind: "day", date: todayKey() } });
    const { result } = setup(fakeRepository([task]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.toggleTask("a"));
    expect(result.current.tasks[0].done).toBe(true);
    expect(result.current.tasks[0].completedAt).toBeTruthy();

    act(() => result.current.toggleTask("a"));
    expect(result.current.tasks[0].done).toBe(false);
    expect(result.current.tasks[0].completedAt).toBeUndefined();
  });

  it("setMemo and removeTask update state and repository", async () => {
    const task = makeTask({ id: "a", scope: { kind: "day", date: todayKey() } });
    const { repo, result } = setup(fakeRepository([task]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.setMemo("a", "details"));
    expect(result.current.tasks[0].memo).toBe("details");

    act(() => result.current.removeTask("a"));
    expect(result.current.tasks).toHaveLength(0);
    await waitFor(() => expect(repo.tasks).toHaveLength(0));
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/store.test.tsx`
Expected: FAIL — cannot resolve `./store`.

- [ ] **Step 4: Implement `store.tsx`**

```tsx
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";

import { createLocalStorageRepository, type TaskRepository } from "./data/repository";
import { todayKey } from "./lib/dates";
import { rolloverTasks } from "./lib/rollover";
import type { Scope, Task } from "./types";

export interface TasksState {
  loaded: boolean;
  tasks: Task[];
}

export type TasksAction =
  | { type: "loaded"; tasks: Task[] }
  | { type: "added"; task: Task }
  | { type: "updated"; task: Task }
  | { type: "removed"; id: string };

export function tasksReducer(
  state: TasksState,
  action: TasksAction,
): TasksState {
  switch (action.type) {
    case "loaded":
      return { loaded: true, tasks: action.tasks };
    case "added":
      return { ...state, tasks: [...state.tasks, action.task] };
    case "updated":
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.task.id ? action.task : t,
        ),
      };
    case "removed":
      return { ...state, tasks: state.tasks.filter((t) => t.id !== action.id) };
  }
}

interface TasksContextValue extends TasksState {
  addTask: (title: string, scope: Scope) => void;
  toggleTask: (id: string) => void;
  setMemo: (id: string, memo: string) => void;
  removeTask: (id: string) => void;
}

const TasksContext = createContext<TasksContextValue | null>(null);

export function TasksProvider({
  repository,
  children,
}: {
  repository?: TaskRepository;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(tasksReducer, {
    loaded: false,
    tasks: [],
  });
  const repo = useMemo(
    () => repository ?? createLocalStorageRepository(),
    [repository],
  );

  useEffect(() => {
    let cancelled = false;
    void repo.list().then((tasks) => {
      if (cancelled) return;
      const rolled = rolloverTasks(tasks, todayKey());
      dispatch({ type: "loaded", tasks: rolled });
      rolled.forEach((task, i) => {
        if (task !== tasks[i]) void repo.update(task);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const value = useMemo<TasksContextValue>(
    () => ({
      ...state,
      addTask(title, scope) {
        const trimmed = title.trim();
        if (!trimmed) return;
        const task: Task = {
          id: crypto.randomUUID(),
          title: trimmed,
          done: false,
          scope,
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: "added", task });
        void repo.create(task);
      },
      toggleTask(id) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const task: Task = {
          ...current,
          done: !current.done,
          completedAt: current.done ? undefined : new Date().toISOString(),
        };
        dispatch({ type: "updated", task });
        void repo.update(task);
      },
      setMemo(id, memo) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const task: Task = { ...current, memo: memo.trim() || undefined };
        dispatch({ type: "updated", task });
        void repo.update(task);
      },
      removeTask(id) {
        dispatch({ type: "removed", id });
        void repo.remove(id);
      },
    }),
    [state, repo],
  );

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}

export function useTasks(): TasksContextValue {
  const context = useContext(TasksContext);
  if (!context) throw new Error("useTasks must be used within TasksProvider");
  return context;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/store.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the whole suite and commit**

Run: `npm test` — expected: all green.

```bash
git add src/features/tasks/store.tsx src/features/tasks/store.test.tsx src/features/tasks/test-utils.tsx
git commit -m "feat: add task store with rollover on load"
```

---

### Task 5: UI primitives — QuickAdd, TaskItem, PeriodCell, ScopeTasks

**Files:**
- Create: `frontend/src/features/tasks/components/quick-add.tsx`
- Create: `frontend/src/features/tasks/components/task-item.tsx`
- Create: `frontend/src/features/tasks/components/period-cell.tsx`
- Create: `frontend/src/features/tasks/components/scope-tasks.tsx`
- Test: `frontend/src/features/tasks/components/primitives.test.tsx`

**Interfaces:**
- Consumes: `useTasks`, `TasksProvider` from `store.tsx`; `Task`, `Scope`, `scopeKey` from `types.ts`; `Checkbox` from `@/components/ui/checkbox`; `cn` from `@/lib/utils`; `RotateCw` from `lucide-react`.
- Produces:
  - `QuickAdd({ onAdd: (title: string) => void; placeholder?: string })` — input, submits on Enter, clears itself
  - `TaskItem({ task: Task; onToggle: () => void; onMemoChange: (memo: string) => void; onDelete: () => void })`
  - `PeriodCell({ focused: boolean; onFocus?: () => void; label?: ReactNode; className?: string; contentClassName?: string; children?: ReactNode })` — faded (opacity, click/Enter to refocus, children non-interactive) vs focused (highlighted ring)
  - `ScopeTasks({ scope: Scope; quickAdd?: boolean; compact?: boolean })` — connected list for one scope; `compact` renders dimmed titles only

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/tasks/components/primitives.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../store";
import { fakeRepository, makeTask } from "../test-utils";
import { PeriodCell } from "./period-cell";
import { QuickAdd } from "./quick-add";
import { ScopeTasks } from "./scope-tasks";
import { TaskItem } from "./task-item";

describe("QuickAdd", () => {
  it("submits trimmed value on Enter and clears", () => {
    const onAdd = vi.fn();
    render(<QuickAdd onAdd={onAdd} />);
    const input = screen.getByLabelText("Add task") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  ship it  " } });
    fireEvent.submit(input.closest("form")!);
    expect(onAdd).toHaveBeenCalledWith("ship it");
    expect(input.value).toBe("");
  });
});

describe("TaskItem", () => {
  const task = makeTask({ id: "a", title: "write tests", memo: "with care" });

  it("toggles via checkbox and shows the rolled marker", () => {
    const onToggle = vi.fn();
    render(
      <TaskItem
        task={{ ...task, rolledFrom: { kind: "day", date: "2026-07-01" } }}
        onToggle={onToggle}
        onMemoChange={() => {}}
        onDelete={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalled();
    expect(screen.getByLabelText("Rolled over")).toBeTruthy();
  });

  it("expands to memo + delete when the title is clicked", () => {
    const onDelete = vi.fn();
    const onMemoChange = vi.fn();
    render(
      <TaskItem
        task={task}
        onToggle={() => {}}
        onMemoChange={onMemoChange}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByText("write tests"));
    const memo = screen.getByPlaceholderText("Memo") as HTMLTextAreaElement;
    expect(memo.value).toBe("with care");
    fireEvent.blur(memo, { target: { value: "updated" } });
    expect(onMemoChange).toHaveBeenCalledWith("updated");
    fireEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalled();
  });
});

describe("PeriodCell", () => {
  it("calls onFocus when faded and clicked", () => {
    const onFocus = vi.fn();
    render(
      <PeriodCell focused={false} onFocus={onFocus} label="W1">
        <span>content</span>
      </PeriodCell>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onFocus).toHaveBeenCalled();
  });

  it("is not a button when focused", () => {
    render(
      <PeriodCell focused label="W1">
        <span>content</span>
      </PeriodCell>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("ScopeTasks", () => {
  it("renders only tasks matching the scope", async () => {
    // Anchored to the current date so rolloverTasks (applied on load) never
    // moves these tasks out of the scopes under test.
    const week = weekStartOf(todayKey());
    const inScope = makeTask({
      id: "in",
      title: "in scope",
      scope: { kind: "week", weekStart: week },
    });
    const outScope = makeTask({
      id: "out",
      title: "out of scope",
      scope: { kind: "day", date: todayKey() },
    });
    render(
      <TasksProvider repository={fakeRepository([inScope, outScope])}>
        <ScopeTasks scope={{ kind: "week", weekStart: week }} quickAdd />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("in scope")).toBeTruthy());
    expect(screen.queryByText("out of scope")).toBeNull();
    expect(screen.getByLabelText("Add task")).toBeTruthy();
  });
});
```

Add the matching import at the top of the test file: `import { todayKey, weekStartOf } from "../lib/dates";`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the four components**

`quick-add.tsx`:

```tsx
"use client";

import { useState } from "react";

export function QuickAdd({
  onAdd,
  placeholder = "Add task",
}: {
  onAdd: (title: string) => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  return (
    <form
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
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-subtle focus-visible:border-input"
      />
    </form>
  );
}
```

`task-item.tsx`:

```tsx
"use client";

import { RotateCw } from "lucide-react";
import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Task } from "../types";

export function TaskItem({
  task,
  onToggle,
  onMemoChange,
  onDelete,
}: {
  task: Task;
  onToggle: () => void;
  onMemoChange: (memo: string) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="flex items-center gap-2">
        <Checkbox
          checked={task.done}
          onCheckedChange={onToggle}
          aria-label={`Toggle ${task.title}`}
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "min-w-0 flex-1 truncate text-left text-sm",
            task.done && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </button>
        {task.rolledFrom && (
          <RotateCw aria-label="Rolled over" className="size-3 shrink-0 text-subtle" />
        )}
      </div>
      {open && (
        <div className="mt-1 space-y-1 pl-6">
          <textarea
            defaultValue={task.memo ?? ""}
            onBlur={(e) => onMemoChange(e.target.value)}
            placeholder="Memo"
            rows={2}
            className="w-full resize-none rounded-md border border-input bg-transparent p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <button
            type="button"
            onClick={onDelete}
            className="text-xs text-destructive hover:underline"
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}
```

Note: if `RotateCw` doesn't forward `aria-label` in the installed lucide version, wrap it: `<span aria-label="Rolled over" role="img"><RotateCw className="size-3 text-subtle" /></span>`.

`period-cell.tsx`:

```tsx
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PeriodCell({
  focused,
  onFocus,
  label,
  className,
  contentClassName,
  children,
}: {
  focused: boolean;
  onFocus?: () => void;
  label?: ReactNode;
  className?: string;
  contentClassName?: string;
  children?: ReactNode;
}) {
  const content = (
    <>
      {label && <div className="mb-1 text-xs font-semibold">{label}</div>}
      <div className={cn(contentClassName, !focused && "pointer-events-none")}>
        {children}
      </div>
    </>
  );

  if (focused) {
    return (
      <div className={cn("rounded-md bg-card ring-1 ring-ring/40", className)}>
        {content}
      </div>
    );
  }

  return (
    <div
      role={onFocus ? "button" : undefined}
      tabIndex={onFocus ? 0 : undefined}
      onClick={onFocus}
      onKeyDown={
        onFocus
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onFocus();
              }
            }
          : undefined
      }
      className={cn(
        "rounded-md opacity-50 transition-opacity",
        onFocus &&
          "cursor-pointer hover:opacity-80 focus-visible:opacity-80 focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      {content}
    </div>
  );
}
```

`scope-tasks.tsx`:

```tsx
"use client";

import { cn } from "@/lib/utils";

import { useTasks } from "../store";
import { scopeKey, type Scope } from "../types";
import { QuickAdd } from "./quick-add";
import { TaskItem } from "./task-item";

export function ScopeTasks({
  scope,
  quickAdd = false,
  compact = false,
}: {
  scope: Scope;
  quickAdd?: boolean;
  compact?: boolean;
}) {
  const { tasks, addTask, toggleTask, setMemo, removeTask } = useTasks();
  const key = scopeKey(scope);
  const scoped = tasks.filter((t) => scopeKey(t.scope) === key);

  if (compact) {
    return (
      <ul className="space-y-0.5">
        {scoped.map((t) => (
          <li
            key={t.id}
            className={cn(
              "truncate text-xs text-muted-foreground",
              t.done && "line-through opacity-60",
            )}
          >
            {t.title}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-1">
      <ul className="space-y-1">
        {scoped.map((t) => (
          <TaskItem
            key={t.id}
            task={t}
            onToggle={() => toggleTask(t.id)}
            onMemoChange={(memo) => setMemo(t.id, memo)}
            onDelete={() => removeTask(t.id)}
          />
        ))}
      </ul>
      {quickAdd && <QuickAdd onAdd={(title) => addTask(title, scope)} />}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: PASS (6 tests). If the Base UI checkbox doesn't respond to `fireEvent.click` on `getByRole("checkbox")`, click the rendered root element (`screen.getByLabelText(/^Toggle/)`) instead.

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/components
git commit -m "feat: add task UI primitives (quick-add, task-item, period-cell, scope-tasks)"
```

---

### Task 6: Weekly view

**Files:**
- Create: `frontend/src/features/tasks/components/views/weekly-view.tsx`
- Test: `frontend/src/features/tasks/components/views/weekly-view.test.tsx`

**Interfaces:**
- Consumes: `monthGrid`, `monthKeyOf`, `monthLabel`, `weekStartOf`, `dayOfMonth`, `todayKey` from `lib/dates.ts`; `PeriodCell`, `ScopeTasks`; `cn`.
- Produces:
  - `export interface CalendarViewProps { anchor: string; onAnchorChange: (dateKey: string) => void }` (defined here, reused by all views)
  - `export const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]`
  - `WeeklyView(props: CalendarViewProps)`

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/tasks/components/views/weekly-view.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeRepository, makeTask } from "../../test-utils";
import { WeeklyView } from "./weekly-view";

const ANCHOR = "2026-07-16"; // focused week: 2026-07-12 .. 2026-07-18

function renderView(onAnchorChange = vi.fn(), tasks = [] as Parameters<typeof fakeRepository>[0]) {
  render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <WeeklyView anchor={ANCHOR} onAnchorChange={onAnchorChange} />
    </TasksProvider>,
  );
  return onAnchorChange;
}

describe("WeeklyView", () => {
  it("renders the month label, day headers, and Weekly column", async () => {
    renderView();
    await waitFor(() => expect(screen.getByText("July 2026")).toBeTruthy());
    expect(screen.getByText("Su")).toBeTruthy();
    expect(screen.getByText("Weekly")).toBeTruthy();
  });

  it("only the focused week offers quick-add inputs (7 days + weekly cell)", async () => {
    renderView();
    await waitFor(() =>
      expect(screen.getAllByLabelText("Add task")).toHaveLength(8),
    );
  });

  it("shows tasks of the focused week and faded rows are clickable", async () => {
    const task = makeTask({
      title: "focused task",
      scope: { kind: "day", date: "2026-07-14" },
    });
    const onAnchorChange = renderView(vi.fn(), [task]);
    await waitFor(() => expect(screen.getByText("focused task")).toBeTruthy());

    const fadedRows = screen.getAllByRole("button", { name: /Week of/ });
    expect(fadedRows).toHaveLength(4); // July 2026 has 5 rows, 1 focused
    fireEvent.click(fadedRows[0]);
    expect(onAnchorChange).toHaveBeenCalledWith("2026-07-01");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/components/views/weekly-view.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `weekly-view.tsx`**

```tsx
"use client";

import { cn } from "@/lib/utils";

import {
  dayOfMonth,
  monthGrid,
  monthKeyOf,
  monthLabel,
  todayKey,
  weekStartOf,
} from "../../lib/dates";
import type { Scope } from "../../types";
import { PeriodCell } from "../period-cell";
import { ScopeTasks } from "../scope-tasks";

export interface CalendarViewProps {
  anchor: string;
  onAnchorChange: (dateKey: string) => void;
}

export const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function WeeklyView({ anchor, onAnchorChange }: CalendarViewProps) {
  const monthKey = monthKeyOf(anchor);
  const grid = monthGrid(monthKey);
  const focusedWeek = weekStartOf(anchor);
  const today = todayKey();

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">{monthLabel(monthKey)}</h2>
      <div className="grid grid-cols-8 gap-1 px-1 text-xs font-medium text-subtle">
        {DAY_LABELS.map((d) => (
          <div key={d} className="px-1.5">
            {d}
          </div>
        ))}
        <div className="px-1.5">Weekly</div>
      </div>
      <div className="mt-1 space-y-1">
        {grid.map((row) => {
          const firstDate = row.find((d): d is string => d !== null)!;
          const weekStart = weekStartOf(firstDate);
          const focused = weekStart === focusedWeek;
          const weekScope: Scope = { kind: "week", weekStart };
          const cellHeight = focused ? "min-h-28" : "min-h-12";

          return (
            <PeriodCell
              key={weekStart}
              focused={focused}
              onFocus={() => onAnchorChange(firstDate)}
              aria-label={`Week of ${firstDate}`}
              className="p-1"
              contentClassName="grid grid-cols-8 gap-1"
            >
              {row.map((date, i) =>
                date ? (
                  <div key={date} className={cn("rounded-md p-1.5", cellHeight)}>
                    <div
                      className={cn(
                        "text-xs",
                        date === today ? "font-bold text-brand" : "text-subtle",
                      )}
                    >
                      {dayOfMonth(date)}
                    </div>
                    <ScopeTasks
                      scope={{ kind: "day", date }}
                      quickAdd={focused}
                      compact={!focused}
                    />
                  </div>
                ) : (
                  <div key={`empty-${i}`} className={cn("p-1.5", cellHeight)} />
                ),
              )}
              <div className={cn("rounded-md bg-muted/40 p-1.5", cellHeight)}>
                <ScopeTasks
                  scope={weekScope}
                  quickAdd={focused}
                  compact={!focused}
                />
              </div>
            </PeriodCell>
          );
        })}
      </div>
    </div>
  );
}
```

**Required tweak to `PeriodCell`:** the `aria-label` above must land on the cell's outer div. Add `"aria-label"?: string` to `PeriodCell`'s props and spread it onto both outer divs (focused and faded):

```tsx
// in period-cell.tsx props: add
"aria-label"?: string;
// destructure as: "aria-label": ariaLabel,
// and add aria-label={ariaLabel} to both outer <div> elements
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/views/weekly-view.test.tsx` and `npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: PASS (both files — PeriodCell change must not break its tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/components
git commit -m "feat: add weekly view with focused-week month grid"
```

---

### Task 7: Daily view

**Files:**
- Create: `frontend/src/features/tasks/components/views/daily-view.tsx`
- Test: `frontend/src/features/tasks/components/views/daily-view.test.tsx`

**Interfaces:**
- Consumes: `CalendarViewProps`, `DAY_LABELS` from `weekly-view.tsx`; `weekStartOf`, `weekDates`, `dayOfMonth`, `monthKeyOf`, `monthLabel` from `lib/dates.ts`; `PeriodCell`, `ScopeTasks`.
- Produces: `DailyView(props: CalendarViewProps)`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/tasks/components/views/daily-view.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeRepository } from "../../test-utils";
import { DailyView } from "./daily-view";

const ANCHOR = "2026-07-16"; // Thursday; week 2026-07-12 .. 2026-07-18

describe("DailyView", () => {
  it("focuses the anchor day: quick-add only there and in the weekly cell", async () => {
    render(
      <TasksProvider repository={fakeRepository()}>
        <DailyView anchor={ANCHOR} onAnchorChange={vi.fn()} />
      </TasksProvider>,
    );
    await waitFor(() =>
      expect(screen.getAllByLabelText("Add task")).toHaveLength(2),
    );
    expect(screen.getByText("Weekly")).toBeTruthy();
    expect(screen.getByText("Th 16")).toBeTruthy();
  });

  it("clicking a faded day refocuses it", async () => {
    const onAnchorChange = vi.fn();
    render(
      <TasksProvider repository={fakeRepository()}>
        <DailyView anchor={ANCHOR} onAnchorChange={onAnchorChange} />
      </TasksProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Su 12" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Su 12" }));
    expect(onAnchorChange).toHaveBeenCalledWith("2026-07-12");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/components/views/daily-view.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `daily-view.tsx`**

```tsx
"use client";

import {
  dayOfMonth,
  monthKeyOf,
  monthLabel,
  weekDates,
  weekStartOf,
} from "../../lib/dates";
import { PeriodCell } from "../period-cell";
import { ScopeTasks } from "../scope-tasks";
import { DAY_LABELS, type CalendarViewProps } from "./weekly-view";

export function DailyView({ anchor, onAnchorChange }: CalendarViewProps) {
  const weekStart = weekStartOf(anchor);
  const dates = weekDates(weekStart);

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">
        {monthLabel(monthKeyOf(anchor))}
      </h2>
      <div className="grid grid-cols-8 gap-1">
        {dates.map((date, i) => {
          const focused = date === anchor;
          const label = `${DAY_LABELS[i]} ${dayOfMonth(date)}`;
          return (
            <PeriodCell
              key={date}
              focused={focused}
              onFocus={() => onAnchorChange(date)}
              aria-label={label}
              label={label}
              className="min-h-40 p-1.5"
            >
              <ScopeTasks
                scope={{ kind: "day", date }}
                quickAdd={focused}
                compact={!focused}
              />
            </PeriodCell>
          );
        })}
        <div className="min-h-40 rounded-md bg-muted/40 p-1.5">
          <div className="mb-1 text-xs font-semibold">Weekly</div>
          <ScopeTasks scope={{ kind: "week", weekStart }} quickAdd />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/views/daily-view.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/components/views/daily-view.tsx src/features/tasks/components/views/daily-view.test.tsx
git commit -m "feat: add daily view with focused-day week strip"
```

---

### Task 8: Monthly and Yearly views (shared year grid)

**Files:**
- Create: `frontend/src/features/tasks/components/views/year-grid.tsx`
- Create: `frontend/src/features/tasks/components/views/monthly-view.tsx`
- Create: `frontend/src/features/tasks/components/views/yearly-view.tsx`
- Test: `frontend/src/features/tasks/components/views/year-views.test.tsx`

**Interfaces:**
- Consumes: `CalendarViewProps` from `weekly-view.tsx`; `monthKeys`, `monthKeyOf`, `monthName`, `yearOf` from `lib/dates.ts`; `PeriodCell`, `ScopeTasks`; `Scope`.
- Produces:
  - `YearGrid({ year: string; focusedMonth?: string; onFocusMonth?: (monthKey: string) => void; sideLabel: string; sideScope: Scope })` — month cells always render compact task previews; when `focusedMonth` is set the others fade and are clickable; the side cell is the full editable list for `sideScope`.
  - `MonthlyView(props: CalendarViewProps)` — side cell edits the focused month's tasks
  - `YearlyView(props: CalendarViewProps)` — no fading; side cell edits year-scope tasks

**Design note (from spec):** month grid cells show compact previews of that month's month-scope tasks; the wide side cell ("Monthly" / "Yearly") is where the focused period's tasks are edited — grid = context, side cell = workspace.

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/tasks/components/views/year-views.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeRepository, makeTask } from "../../test-utils";
import { MonthlyView } from "./monthly-view";
import { YearlyView } from "./yearly-view";

const ANCHOR = "2026-07-16";

describe("MonthlyView", () => {
  it("renders 12 months, fades non-current, and edits the focused month in the side cell", async () => {
    const task = makeTask({
      title: "july goal",
      scope: { kind: "month", month: "2026-07" },
    });
    render(
      <TasksProvider repository={fakeRepository([task])}>
        <MonthlyView anchor={ANCHOR} onAnchorChange={vi.fn()} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("2026")).toBeTruthy());
    expect(screen.getByText("January")).toBeTruthy();
    expect(screen.getByText("December")).toBeTruthy();
    expect(screen.getByText("Monthly")).toBeTruthy();
    // task appears twice: compact preview in the July cell + editable side cell
    expect(screen.getAllByText("july goal")).toHaveLength(2);
    expect(screen.getAllByLabelText("Add task")).toHaveLength(1);
    // 11 faded month cells are buttons
    expect(screen.getAllByRole("button", { name: /^Focus/ })).toHaveLength(11);
  });

  it("clicking a faded month refocuses to its first day", async () => {
    const onAnchorChange = vi.fn();
    render(
      <TasksProvider repository={fakeRepository()}>
        <MonthlyView anchor={ANCHOR} onAnchorChange={onAnchorChange} />
      </TasksProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Focus March" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Focus March" }));
    expect(onAnchorChange).toHaveBeenCalledWith("2026-03-01");
  });
});

describe("YearlyView", () => {
  it("renders all months without fading and a Yearly side cell", async () => {
    render(
      <TasksProvider repository={fakeRepository()}>
        <YearlyView anchor={ANCHOR} onAnchorChange={vi.fn()} />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText("Yearly")).toBeTruthy());
    expect(screen.queryAllByRole("button", { name: /^Focus/ })).toHaveLength(0);
    expect(screen.getAllByLabelText("Add task")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/components/views/year-views.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three files**

`year-grid.tsx`:

```tsx
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
```

`monthly-view.tsx`:

```tsx
"use client";

import { monthKeyOf, yearOf } from "../../lib/dates";
import { YearGrid } from "./year-grid";
import type { CalendarViewProps } from "./weekly-view";

export function MonthlyView({ anchor, onAnchorChange }: CalendarViewProps) {
  const focusedMonth = monthKeyOf(anchor);
  return (
    <YearGrid
      year={yearOf(anchor)}
      focusedMonth={focusedMonth}
      onFocusMonth={(month) => onAnchorChange(`${month}-01`)}
      sideLabel="Monthly"
      sideScope={{ kind: "month", month: focusedMonth }}
    />
  );
}
```

`yearly-view.tsx`:

```tsx
"use client";

import { yearOf } from "../../lib/dates";
import { YearGrid } from "./year-grid";
import type { CalendarViewProps } from "./weekly-view";

export function YearlyView({ anchor }: CalendarViewProps) {
  const year = yearOf(anchor);
  return (
    <YearGrid year={year} sideLabel="Yearly" sideScope={{ kind: "year", year }} />
  );
}
```

Note: the focused month cell in `MonthlyView` keeps the compact preview (the side cell is the editor), so `PeriodCell focused` there only provides the highlight. The `aria-label` lands only on faded cells' `role="button"` — the focused cell's div having an aria-label but no role is harmless.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/views/year-views.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/components/views
git commit -m "feat: add monthly and yearly views with shared year grid"
```

---

### Task 9: View switcher, TaskCalendar shell, /app page integration

**Files:**
- Create: `frontend/src/features/tasks/components/view-switcher.tsx`
- Create: `frontend/src/features/tasks/components/task-calendar.tsx`
- Test: `frontend/src/features/tasks/components/task-calendar.test.tsx`
- Modify: `frontend/src/app/app/page.tsx` (full rewrite)
- Modify: `frontend/src/app/globals.css` (remove now-unused legacy classes)

**Interfaces:**
- Consumes: all four views; `TasksProvider`, `useTasks`; `addDays`, `monthKeyOf`, `nextMonthKey`, `prevMonthKey`, `todayKey`, `yearOf`; `Button` from `@/components/ui/button`; `Wordmark` from `@/components/wordmark`; `LogoutButton` from `@/features/auth/components/logout-button`; `ChevronLeft`, `ChevronRight` from `lucide-react`.
- Produces:
  - `view-switcher.tsx`: `type ViewKind = "daily" | "weekly" | "monthly" | "yearly"`, `const VIEWS: readonly ViewKind[]`, `ViewSwitcher({ view, onViewChange, onPrev, onNext, onToday })`
  - `task-calendar.tsx`: `TaskCalendar()` (no props; wraps everything in `TasksProvider`), `shiftAnchor(view: ViewKind, anchor: string, dir: 1 | -1): string` (exported for tests)

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/tasks/components/task-calendar.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { shiftAnchor, TaskCalendar } from "./task-calendar";

describe("shiftAnchor", () => {
  it("daily pages by week", () => {
    expect(shiftAnchor("daily", "2026-07-16", 1)).toBe("2026-07-23");
    expect(shiftAnchor("daily", "2026-07-16", -1)).toBe("2026-07-09");
  });

  it("weekly pages by month to the 1st", () => {
    expect(shiftAnchor("weekly", "2026-07-16", 1)).toBe("2026-08-01");
    expect(shiftAnchor("weekly", "2026-01-16", -1)).toBe("2025-12-01");
  });

  it("monthly and yearly page by year, keeping the month", () => {
    expect(shiftAnchor("monthly", "2026-07-16", 1)).toBe("2027-07-01");
    expect(shiftAnchor("yearly", "2026-07-16", -1)).toBe("2025-07-01");
  });
});

describe("TaskCalendar", () => {
  it("defaults to the weekly view and switches scales", async () => {
    render(<TaskCalendar />);
    // "Weekly"/"Yearly" appear both as tab labels and grid headers, so query
    // tabs by role and assert view content via text unique to each view.
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Weekly", selected: true }),
      ).toBeTruthy(),
    );
    expect(screen.getByText("Su")).toBeTruthy(); // weekly grid day header

    fireEvent.click(screen.getByRole("tab", { name: "Yearly" }));
    await waitFor(() => expect(screen.getByText("January")).toBeTruthy());
  });
});
```

Note: `TaskCalendar` without a repository prop uses real `window.localStorage` — fine under jsdom (empty storage).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/components/task-calendar.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `view-switcher.tsx`**

```tsx
"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const VIEWS = ["daily", "weekly", "monthly", "yearly"] as const;
export type ViewKind = (typeof VIEWS)[number];

const VIEW_LABELS: Record<ViewKind, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

export function ViewSwitcher({
  view,
  onViewChange,
  onPrev,
  onNext,
  onToday,
}: {
  view: ViewKind;
  onViewChange: (view: ViewKind) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div
        role="tablist"
        aria-label="Calendar scale"
        className="flex rounded-lg border border-border p-0.5"
      >
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => onViewChange(v)}
            className={cn(
              "rounded-md px-3 py-1 text-sm transition-colors",
              view === v
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {VIEW_LABELS[v]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={onPrev} aria-label="Previous">
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="sm" onClick={onToday}>
          Today
        </Button>
        <Button variant="ghost" size="icon" onClick={onNext} aria-label="Next">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `task-calendar.tsx`**

```tsx
"use client";

import { useState } from "react";

import {
  addDays,
  monthKeyOf,
  nextMonthKey,
  prevMonthKey,
  todayKey,
  yearOf,
} from "../lib/dates";
import { TasksProvider, useTasks } from "../store";
import { ViewSwitcher, type ViewKind } from "./view-switcher";
import { DailyView } from "./views/daily-view";
import { MonthlyView } from "./views/monthly-view";
import { WeeklyView } from "./views/weekly-view";
import { YearlyView } from "./views/yearly-view";

export function shiftAnchor(
  view: ViewKind,
  anchor: string,
  dir: 1 | -1,
): string {
  switch (view) {
    case "daily":
      return addDays(anchor, 7 * dir);
    case "weekly": {
      const month =
        dir === 1
          ? nextMonthKey(monthKeyOf(anchor))
          : prevMonthKey(monthKeyOf(anchor));
      return `${month}-01`;
    }
    case "monthly":
    case "yearly":
      return `${Number(yearOf(anchor)) + dir}-${anchor.slice(5, 7)}-01`;
  }
}

const VIEW_COMPONENTS = {
  daily: DailyView,
  weekly: WeeklyView,
  monthly: MonthlyView,
  yearly: YearlyView,
} as const;

function CalendarInner() {
  const { loaded } = useTasks();
  const [view, setView] = useState<ViewKind>("weekly");
  const [anchor, setAnchor] = useState(() => todayKey());

  // Nothing date-dependent renders before the client loads tasks, which
  // keeps server and client markup identical during hydration.
  if (!loaded) return <div aria-busy="true" className="min-h-64" />;

  const View = VIEW_COMPONENTS[view];
  return (
    <div className="space-y-4">
      <ViewSwitcher
        view={view}
        onViewChange={setView}
        onToday={() => setAnchor(todayKey())}
        onPrev={() => setAnchor((a) => shiftAnchor(view, a, -1))}
        onNext={() => setAnchor((a) => shiftAnchor(view, a, 1))}
      />
      <View anchor={anchor} onAnchorChange={setAnchor} />
    </div>
  );
}

export function TaskCalendar() {
  return (
    <TasksProvider>
      <CalendarInner />
    </TasksProvider>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/task-calendar.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: Rewrite `src/app/app/page.tsx`**

```tsx
import { LogoutButton } from "@/features/auth/components/logout-button";
import { TaskCalendar } from "@/features/tasks/components/task-calendar";
import { Wordmark } from "@/components/wordmark";

export default function AppPage() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-6xl px-6 py-6">
      <header className="flex items-center justify-between gap-4">
        <Wordmark />
        <LogoutButton />
      </header>
      <main className="mt-6">
        <TaskCalendar />
      </main>
    </div>
  );
}
```

- [ ] **Step 7: Remove now-unused legacy CSS**

For each legacy class in `globals.css` (`.app-shell`, `.app-header`, `.app-main`, `.panel`, `.nav-list`, `.eyebrow`, and the legacy `@media` block), grep the `src/` tree for usages (`grep -rn "app-shell\|app-header\|app-main\|panel\|nav-list\|eyebrow" src/`). Delete every class with zero remaining usages, along with the "Legacy styles" comment block if it empties out. Keep any class that still has a consumer.

- [ ] **Step 8: Full verification**

```bash
npm test        # all suites green
npm run lint    # no errors
npm run build   # compiles
```

Then run `npm run dev` and manually verify at `http://localhost:10050/app` (log in first):
1. Weekly view shows the current month with this week highlighted and others faded.
2. Add a task to today and to the Weekly cell; toggle it; add a memo; delete one.
3. Click a faded week — focus moves; click Today — focus returns.
4. Switch to Daily, Monthly, Yearly — each renders per spec; Monthly side cell edits the focused month.
5. Reload the page — tasks persist.

- [ ] **Step 9: Commit**

```bash
git add src/features/tasks/components src/app/app/page.tsx src/app/globals.css
git commit -m "feat: wire task calendar into /app with view switcher"
```

# Daily Timeline & Subtasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Daily view as an iPad-style centered timeline (rolling 7-day window, focused day enlarged with a 00:00–23:59 hour rail), add optional task times, and add one level of subtasks with progress badges.

**Architecture:** Additive change to the existing task feature (`frontend/src/features/tasks/`): new pure module `lib/times.ts`, new fields on `Task` (`time?`, `subtasks?`) normalized at the repository read boundary, four new store actions, a `SubtaskList` + `DayTimeline` component pair, and a rebuilt `DailyView`. Storage stays `picking-up.tasks.v1` — no migration. Spec: `docs/superpowers/specs/2026-07-16-daily-timeline-subtasks-design.md`.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, Tailwind 4 tokens, Vitest + Testing Library (already configured; `vitest.setup.ts` runs RTL cleanup + `localStorage.clear()`).

## Global Constraints

- Work on branch `feat/daily-timeline` (create from `main` before Task 1).
- All commands run inside `frontend/`.
- Date keys are strings; ISO string comparison only. Times are `"HH:MM"` (24h, zero-padded) strings, ordered by string comparison — never compare `Date` objects.
- Storage key stays `"picking-up.tasks.v1"`; new fields are optional/additive; the read path **normalizes** new fields (never drops a whole task for a bad `time`/`subtasks`).
- New code under `frontend/src/features/tasks/`; tests colocated.
- No legacy CSS classes — Tailwind utilities with existing tokens only (`bg-card`, `text-subtle`, `text-brand`, `ring-ring`, `bg-muted`, `border-border`, `text-destructive`).
- Interactive components need `"use client"`.
- Tests must not depend on the wall clock: pin with `vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime(...)` (only `Date` faked so RTL `waitFor` works), or derive fixtures from `todayKey()`.
- Commit style: conventional commits, each message ending with the line:
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

---

### Task 1: Time utilities + date-window helpers

**Files:**
- Create: `frontend/src/features/tasks/lib/times.ts`
- Test: `frontend/src/features/tasks/lib/times.test.ts`
- Modify: `frontend/src/features/tasks/lib/dates.ts` (append three functions)
- Test: `frontend/src/features/tasks/lib/dates.test.ts` (append one describe block)

**Interfaces:**
- Consumes: `addDays` (existing in `dates.ts`); `Task` from `../types`.
- Produces (`lib/times.ts`):
  - `isValidTime(value: string): boolean` — `"HH:MM"`, hours 00–23, minutes 00–59
  - `nowTime(): string` — current time as `"HH:MM"`
  - `timeToMinutes(time: string): number` — `"09:30"` → 570
  - `compareTasksForDay(a: Task, b: Task): number` — timed before untimed; timed ascending by time; 0 otherwise (callers rely on stable sort for insertion order)
- Produces (appended to `lib/dates.ts`):
  - `windowAround(anchor: string, radius?: number): string[]` — `2*radius+1` (default 7) consecutive date keys centered on the anchor
  - `weekdayOf(dateKey: string): number` — 0 (Sunday) … 6 (Saturday)
  - `dayLabel(dateKey: string): string` — `"Thursday, July 16"`

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/tasks/lib/times.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Task } from "../types";
import { compareTasksForDay, isValidTime, nowTime, timeToMinutes } from "./times";

function task(overrides: Partial<Task>): Task {
  return {
    id: crypto.randomUUID(),
    title: "t",
    done: false,
    scope: { kind: "day", date: "2026-07-16" },
    createdAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("isValidTime", () => {
  it("accepts zero-padded 24h times and rejects everything else", () => {
    expect(isValidTime("00:00")).toBe(true);
    expect(isValidTime("09:30")).toBe(true);
    expect(isValidTime("23:59")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("12:60")).toBe(false);
    expect(isValidTime("9:30")).toBe(false);
    expect(isValidTime("")).toBe(false);
    expect(isValidTime("nine")).toBe(false);
  });
});

describe("nowTime", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 16, 14, 5));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("returns the current zero-padded HH:MM", () => {
    expect(nowTime()).toBe("14:05");
  });
});

describe("timeToMinutes", () => {
  it("converts HH:MM to minutes since midnight", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("23:59")).toBe(1439);
  });
});

describe("compareTasksForDay", () => {
  it("orders timed before untimed, timed ascending by time", () => {
    const nine = task({ time: "09:00" });
    const noon = task({ time: "12:00" });
    const untimed = task({});
    const sorted = [untimed, noon, nine].sort(compareTasksForDay);
    expect(sorted).toEqual([nine, noon, untimed]);
  });

  it("returns 0 for two untimed tasks (stable sort keeps insertion order)", () => {
    expect(compareTasksForDay(task({}), task({}))).toBe(0);
  });
});
```

Append to `frontend/src/features/tasks/lib/dates.test.ts` (add `windowAround, weekdayOf, dayLabel` to the existing import from `./dates`):

```ts
describe("window and day labels", () => {
  it("windowAround centers the anchor and crosses month boundaries", () => {
    const window = windowAround("2026-08-01");
    expect(window).toHaveLength(7);
    expect(window[3]).toBe("2026-08-01");
    expect(window[0]).toBe("2026-07-29");
    expect(window[6]).toBe("2026-08-04");
  });

  it("windowAround honors a custom radius", () => {
    expect(windowAround("2026-07-16", 1)).toEqual([
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
    ]);
  });

  it("weekdayOf returns 0=Sunday..6=Saturday", () => {
    expect(weekdayOf("2026-07-12")).toBe(0); // Sunday
    expect(weekdayOf("2026-07-16")).toBe(4); // Thursday
  });

  it("dayLabel formats a full day heading", () => {
    expect(dayLabel("2026-07-16")).toBe("Thursday, July 16");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/lib/times.test.ts src/features/tasks/lib/dates.test.ts`
Expected: FAIL — cannot resolve `./times`; `windowAround` not exported.

- [ ] **Step 3: Implement**

`frontend/src/features/tasks/lib/times.ts`:

```ts
import type { Task } from "../types";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

export function nowTime(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function compareTasksForDay(a: Task, b: Task): number {
  if (a.time && b.time) {
    return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
  }
  if (a.time) return -1;
  if (b.time) return 1;
  return 0;
}
```

Append to `frontend/src/features/tasks/lib/dates.ts` (the private `parse` helper already exists at the top of the file):

```ts
export function windowAround(anchor: string, radius = 3): string[] {
  return Array.from({ length: radius * 2 + 1 }, (_, i) =>
    addDays(anchor, i - radius),
  );
}

export function weekdayOf(dateKey: string): number {
  return parse(dateKey).getDay();
}

export function dayLabel(dateKey: string): string {
  return parse(dateKey).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/lib/times.test.ts src/features/tasks/lib/dates.test.ts`
Expected: PASS (all, including the pre-existing dates tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/lib/times.ts src/features/tasks/lib/times.test.ts src/features/tasks/lib/dates.ts src/features/tasks/lib/dates.test.ts
git commit -m "feat: add time utilities and rolling-window date helpers"
```

---

### Task 2: Task model fields + repository normalization

**Files:**
- Modify: `frontend/src/features/tasks/types.ts`
- Modify: `frontend/src/features/tasks/data/repository.ts`
- Test: `frontend/src/features/tasks/data/repository.test.ts` (append one describe block)

**Interfaces:**
- Consumes: existing `isTask`/`isScope`/`read` structure in `repository.ts`; `isValidTime` from `../lib/times`.
- Produces:
  - `types.ts` additionally exports `interface Subtask { id: string; title: string; done: boolean }`; `Task` gains `time?: string` and `subtasks?: Subtask[]`.
  - Repository read path normalizes: invalid `time` → cleared; non-array `subtasks` → dropped; malformed subtask entries → filtered. Task kept in all three cases.

- [ ] **Step 1: Add the type fields**

In `frontend/src/features/tasks/types.ts`, add above `Task` and extend it:

```ts
export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}
```

```ts
export interface Task {
  id: string;
  title: string;
  memo?: string;
  done: boolean;
  scope: Scope;
  rolledFrom?: Scope;
  createdAt: string;
  completedAt?: string;
  time?: string; // "HH:MM", 24h zero-padded; meaningful on day-scoped tasks
  subtasks?: Subtask[]; // one level deep; no scope/memo/time of their own
}
```

- [ ] **Step 2: Write the failing normalization tests**

Append to `frontend/src/features/tasks/data/repository.test.ts`:

```ts
describe("v2 field normalization", () => {
  it("round-trips time and subtasks", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const timed: Task = {
      ...task,
      id: "timed",
      time: "09:30",
      subtasks: [{ id: "s1", title: "detail", done: false }],
    };
    await repo.create(timed);
    expect(await repo.list()).toEqual([timed]);
  });

  it("clears an invalid time but keeps the task", async () => {
    const repo = createLocalStorageRepository(
      fakeStorage({
        "picking-up.tasks.v1": JSON.stringify([{ ...task, time: "25:99" }]),
      }),
    );
    const [loaded] = await repo.list();
    expect(loaded.id).toBe(task.id);
    expect(loaded.time).toBeUndefined();
  });

  it("drops a non-array subtasks field but keeps the task", async () => {
    const repo = createLocalStorageRepository(
      fakeStorage({
        "picking-up.tasks.v1": JSON.stringify([{ ...task, subtasks: "junk" }]),
      }),
    );
    const [loaded] = await repo.list();
    expect(loaded.id).toBe(task.id);
    expect(loaded.subtasks).toBeUndefined();
  });

  it("filters malformed subtask entries, keeping valid ones", async () => {
    const good = { id: "s1", title: "ok", done: true };
    const repo = createLocalStorageRepository(
      fakeStorage({
        "picking-up.tasks.v1": JSON.stringify([
          { ...task, subtasks: [good, { id: "s2" }, null, { id: 3, title: "x", done: false }] },
        ]),
      }),
    );
    const [loaded] = await repo.list();
    expect(loaded.subtasks).toEqual([good]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/data/repository.test.ts`
Expected: the round-trip test may pass (fields are pass-through), but the three normalization tests FAIL (invalid values survive unchanged).

- [ ] **Step 4: Implement normalization in `repository.ts`**

Replace the existing `import type { Task } from "../types";` line with the two lines below, then add the helpers (below `isScope`):

```ts
import { isValidTime } from "../lib/times";
import type { Subtask, Task } from "../types";
```

```ts
function isSubtask(value: unknown): value is Subtask {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.title === "string" &&
    typeof s.done === "boolean"
  );
}

// The read path normalizes v2 fields instead of rejecting the whole task:
// only v1 structural validation (isTask/isScope) may drop a task.
function normalizeTask(task: Task): Task {
  let time = task.time;
  if (time !== undefined && (typeof time !== "string" || !isValidTime(time))) {
    time = undefined;
  }

  let subtasks = task.subtasks;
  if (subtasks !== undefined) {
    subtasks = Array.isArray(subtasks) ? subtasks.filter(isSubtask) : undefined;
  }

  if (time === task.time && subtasks === task.subtasks) return task;
  return { ...task, time, subtasks };
}
```

In `read()`, change the return line:

```ts
return parsed.filter(isTask).map(normalizeTask);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/data/repository.test.ts`
Expected: PASS (all, including the pre-existing v1 tests).

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/types.ts src/features/tasks/data/repository.ts src/features/tasks/data/repository.test.ts
git commit -m "feat: add task time and subtasks fields with read normalization"
```

---

### Task 3: Store actions for time and subtasks

**Files:**
- Modify: `frontend/src/features/tasks/store.tsx`
- Test: `frontend/src/features/tasks/store.test.tsx` (append one describe block)

**Interfaces:**
- Consumes: existing `TasksProvider`/reducer (unchanged); `isValidTime` from `./lib/times`; `Subtask` from `./types`.
- Produces — `useTasks()` additionally returns:
  - `setTime(id: string, time: string | undefined): void` — validates with `isValidTime` when defined (invalid → no-op)
  - `addSubtask(id: string, title: string): void` — trims; blank → no-op; appends `{ id: crypto.randomUUID(), title, done: false }`
  - `toggleSubtask(id: string, subtaskId: string): void`
  - `removeSubtask(id: string, subtaskId: string): void`
  - All dispatch `{ type: "updated", task }` and persist via `repo.update` (same pattern as `setMemo`). The reducer is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/features/tasks/store.test.tsx` (inside the file; reuse the existing `setup`/`fakeRepository` helpers):

```ts
describe("time and subtask actions", () => {
  it("setTime sets, rejects invalid, and clears", async () => {
    const task = makeTask({ id: "a", scope: { kind: "day", date: todayKey() } });
    const { repo, result } = setup(fakeRepository([task]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.setTime("a", "09:30"));
    expect(result.current.tasks[0].time).toBe("09:30");
    await waitFor(() => expect(repo.tasks[0].time).toBe("09:30"));

    act(() => result.current.setTime("a", "25:00"));
    expect(result.current.tasks[0].time).toBe("09:30"); // invalid ignored

    act(() => result.current.setTime("a", undefined));
    expect(result.current.tasks[0].time).toBeUndefined();
  });

  it("addSubtask trims and ignores blank titles", async () => {
    const task = makeTask({ id: "a", scope: { kind: "day", date: todayKey() } });
    const { repo, result } = setup(fakeRepository([task]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => {
      result.current.addSubtask("a", "   ");
      result.current.addSubtask("a", "  buy nails  ");
    });
    expect(result.current.tasks[0].subtasks).toHaveLength(1);
    expect(result.current.tasks[0].subtasks![0]).toMatchObject({
      title: "buy nails",
      done: false,
    });
    await waitFor(() => expect(repo.tasks[0].subtasks).toHaveLength(1));
  });

  it("toggleSubtask flips one subtask; removeSubtask deletes it", async () => {
    const task = makeTask({
      id: "a",
      scope: { kind: "day", date: todayKey() },
      subtasks: [
        { id: "s1", title: "one", done: false },
        { id: "s2", title: "two", done: false },
      ],
    });
    const { repo, result } = setup(fakeRepository([task]));
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.toggleSubtask("a", "s1"));
    expect(result.current.tasks[0].subtasks).toEqual([
      { id: "s1", title: "one", done: true },
      { id: "s2", title: "two", done: false },
    ]);

    act(() => result.current.removeSubtask("a", "s2"));
    expect(result.current.tasks[0].subtasks).toEqual([
      { id: "s1", title: "one", done: true },
    ]);
    await waitFor(() => expect(repo.tasks[0].subtasks).toHaveLength(1));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/store.test.tsx`
Expected: FAIL — `setTime` is not a function.

- [ ] **Step 3: Implement the actions in `store.tsx`**

Add the import:

```ts
import { isValidTime } from "./lib/times";
```

Extend `TasksContextValue`:

```ts
interface TasksContextValue extends TasksState {
  addTask: (title: string, scope: Scope) => void;
  toggleTask: (id: string) => void;
  setMemo: (id: string, memo: string) => void;
  setTime: (id: string, time: string | undefined) => void;
  removeTask: (id: string) => void;
  addSubtask: (id: string, title: string) => void;
  toggleSubtask: (id: string, subtaskId: string) => void;
  removeSubtask: (id: string, subtaskId: string) => void;
}
```

Inside the `useMemo` value, add after `setMemo` (same find/dispatch/persist pattern):

```ts
setTime(id, time) {
  const current = state.tasks.find((t) => t.id === id);
  if (!current) return;
  if (time !== undefined && !isValidTime(time)) return;
  const task: Task = { ...current, time };
  dispatch({ type: "updated", task });
  void repo.update(task);
},
addSubtask(id, title) {
  const current = state.tasks.find((t) => t.id === id);
  if (!current) return;
  const trimmed = title.trim();
  if (!trimmed) return;
  const task: Task = {
    ...current,
    subtasks: [
      ...(current.subtasks ?? []),
      { id: crypto.randomUUID(), title: trimmed, done: false },
    ],
  };
  dispatch({ type: "updated", task });
  void repo.update(task);
},
toggleSubtask(id, subtaskId) {
  const current = state.tasks.find((t) => t.id === id);
  if (!current?.subtasks) return;
  const task: Task = {
    ...current,
    subtasks: current.subtasks.map((s) =>
      s.id === subtaskId ? { ...s, done: !s.done } : s,
    ),
  };
  dispatch({ type: "updated", task });
  void repo.update(task);
},
removeSubtask(id, subtaskId) {
  const current = state.tasks.find((t) => t.id === id);
  if (!current?.subtasks) return;
  const task: Task = {
    ...current,
    subtasks: current.subtasks.filter((s) => s.id !== subtaskId),
  };
  dispatch({ type: "updated", task });
  void repo.update(task);
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/store.test.tsx`
Expected: PASS (all, including pre-existing store tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/store.tsx src/features/tasks/store.test.tsx
git commit -m "feat: add store actions for task time and subtasks"
```

---

### Task 4: TaskItem v2, SubtaskList, ScopeTasks updates

**Files:**
- Create: `frontend/src/features/tasks/components/subtask-list.tsx`
- Modify: `frontend/src/features/tasks/components/task-item.tsx` (full rewrite below)
- Modify: `frontend/src/features/tasks/components/scope-tasks.tsx` (full rewrite below)
- Modify: `frontend/src/features/tasks/components/primitives.test.tsx` (update TaskItem prop wiring; append new tests)

**Interfaces:**
- Consumes: `Checkbox`, `cn`, `QuickAdd` (existing); `compareTasksForDay` from `../lib/times`; store actions from Task 3.
- Produces:
  - `SubtaskList({ subtasks: Subtask[]; onAdd(title): void; onToggle(subtaskId): void; onRemove(subtaskId): void })` — QuickAdd inside uses placeholder/aria-label `"Add subtask"`.
  - `TaskItem` props grow to `{ task, onToggle(), onMemoChange(memo), onTimeChange(time?: string), onDelete(), onAddSubtask(title), onToggleSubtask(subtaskId), onRemoveSubtask(subtaskId) }` — all required.
  - `taskItemHandlers(id, actions)` exported from `task-item.tsx` — builds the seven callbacks from store actions; used by `ScopeTasks` (this task) and `DayTimeline` (Task 5).
  - Collapsed row renders: optional `HH:MM` time prefix, title, optional `done/total` progress badge (`aria-label="Subtasks: d/t"`), rolled marker. Expansion renders: time input (`aria-label="Task time"`) + Clear button, memo, `SubtaskList`, Delete.
  - `ScopeTasks`: day-scope lists sorted with `compareTasksForDay` (stable); compact rows show time prefix + `· d/t` badge suffix.

- [ ] **Step 1: Update existing tests and add new ones (failing first)**

In `frontend/src/features/tasks/components/primitives.test.tsx`, the two existing `TaskItem` renders pass only `onToggle/onMemoChange/onDelete` — TypeScript will fail once props become required. Add a helper near the top of the file and use it in BOTH existing TaskItem tests (spreading it, with the specific spies still passed explicitly where asserted):

```tsx
const noopHandlers = {
  onToggle: () => {},
  onMemoChange: (_memo: string) => {},
  onTimeChange: (_time?: string) => {},
  onDelete: () => {},
  onAddSubtask: (_title: string) => {},
  onToggleSubtask: (_id: string) => {},
  onRemoveSubtask: (_id: string) => {},
};
```

Example rewrite of the first existing TaskItem test's render:

```tsx
render(
  <TaskItem
    task={{ ...task, rolledFrom: { kind: "day", date: "2026-07-01" } }}
    {...noopHandlers}
    onToggle={onToggle}
  />,
);
```

(Apply the same `{...noopHandlers}` + explicit-spy pattern to the second TaskItem test with `onMemoChange`/`onDelete`.)

Append new tests:

```tsx
import { SubtaskList } from "./subtask-list";

describe("TaskItem v2", () => {
  it("shows time prefix and subtask progress badge on the collapsed row", () => {
    render(
      <TaskItem
        task={makeTask({
          title: "dentist",
          time: "14:00",
          subtasks: [
            { id: "s1", title: "a", done: true },
            { id: "s2", title: "b", done: false },
          ],
        })}
        {...noopHandlers}
      />,
    );
    expect(screen.getByText("14:00")).toBeTruthy();
    expect(screen.getByLabelText("Subtasks: 1/2").textContent).toBe("1/2");
  });

  it("edits and clears the time from the expansion", () => {
    const onTimeChange = vi.fn();
    render(
      <TaskItem
        task={makeTask({ title: "dentist", time: "14:00" })}
        {...noopHandlers}
        onTimeChange={onTimeChange}
      />,
    );
    fireEvent.click(screen.getByText("dentist"));
    fireEvent.change(screen.getByLabelText("Task time"), {
      target: { value: "15:30" },
    });
    expect(onTimeChange).toHaveBeenCalledWith("15:30");
    fireEvent.click(screen.getByText("Clear"));
    expect(onTimeChange).toHaveBeenCalledWith(undefined);
  });

  it("renders the subtask list in the expansion", () => {
    render(
      <TaskItem
        task={makeTask({
          title: "build shelf",
          subtasks: [{ id: "s1", title: "buy wood", done: false }],
        })}
        {...noopHandlers}
      />,
    );
    fireEvent.click(screen.getByText("build shelf"));
    expect(screen.getByText("buy wood")).toBeTruthy();
    expect(screen.getByLabelText("Add subtask")).toBeTruthy();
  });
});

describe("SubtaskList", () => {
  it("wires toggle, remove, and add", () => {
    const onToggle = vi.fn();
    const onRemove = vi.fn();
    const onAdd = vi.fn();
    render(
      <SubtaskList
        subtasks={[{ id: "s1", title: "buy wood", done: false }]}
        onAdd={onAdd}
        onToggle={onToggle}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByLabelText("Toggle buy wood"));
    expect(onToggle).toHaveBeenCalledWith("s1");
    fireEvent.click(screen.getByLabelText("Delete buy wood"));
    expect(onRemove).toHaveBeenCalledWith("s1");
    const input = screen.getByLabelText("Add subtask");
    fireEvent.change(input, { target: { value: "sand it" } });
    fireEvent.submit(input.closest("form")!);
    expect(onAdd).toHaveBeenCalledWith("sand it");
  });
});

describe("ScopeTasks v2", () => {
  it("sorts day lists timed-first and shows prefix + badge in compact mode", async () => {
    const day = todayKey();
    const untimed = makeTask({ id: "u", title: "untimed", scope: { kind: "day", date: day } });
    const timed = makeTask({
      id: "t",
      title: "timed",
      time: "08:00",
      scope: { kind: "day", date: day },
      subtasks: [{ id: "s1", title: "x", done: true }],
    });
    render(
      <TasksProvider repository={fakeRepository([untimed, timed])}>
        <ScopeTasks scope={{ kind: "day", date: day }} compact />
      </TasksProvider>,
    );
    await waitFor(() => expect(screen.getByText(/timed/)).toBeTruthy());
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toContain("08:00");
    expect(items[0]).toContain("1/1");
    expect(items[1]).toContain("untimed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: FAIL — `subtask-list` not found; TaskItem lacks the new props/markup.

- [ ] **Step 3: Implement**

`frontend/src/features/tasks/components/subtask-list.tsx`:

```tsx
"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Subtask } from "../types";
import { QuickAdd } from "./quick-add";

export function SubtaskList({
  subtasks,
  onAdd,
  onToggle,
  onRemove,
}: {
  subtasks: Subtask[];
  onAdd: (title: string) => void;
  onToggle: (subtaskId: string) => void;
  onRemove: (subtaskId: string) => void;
}) {
  return (
    <div className="space-y-1">
      <ul className="space-y-0.5">
        {subtasks.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <Checkbox
              checked={s.done}
              onCheckedChange={() => onToggle(s.id)}
              aria-label={`Toggle ${s.title}`}
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-xs",
                s.done && "text-muted-foreground line-through",
              )}
            >
              {s.title}
            </span>
            <button
              type="button"
              onClick={() => onRemove(s.id)}
              aria-label={`Delete ${s.title}`}
              className="text-xs text-subtle hover:text-destructive"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <QuickAdd onAdd={onAdd} placeholder="Add subtask" />
    </div>
  );
}
```

`frontend/src/features/tasks/components/task-item.tsx` (full replacement):

```tsx
"use client";

import { RotateCw } from "lucide-react";
import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Task } from "../types";
import { SubtaskList } from "./subtask-list";

interface TaskItemActions {
  toggleTask: (id: string) => void;
  setMemo: (id: string, memo: string) => void;
  setTime: (id: string, time: string | undefined) => void;
  removeTask: (id: string) => void;
  addSubtask: (id: string, title: string) => void;
  toggleSubtask: (id: string, subtaskId: string) => void;
  removeSubtask: (id: string, subtaskId: string) => void;
}

// Builds TaskItem's callback props from store actions; shared by ScopeTasks
// and DayTimeline so the wiring lives in one place.
export function taskItemHandlers(id: string, actions: TaskItemActions) {
  return {
    onToggle: () => actions.toggleTask(id),
    onMemoChange: (memo: string) => actions.setMemo(id, memo),
    onTimeChange: (time?: string) => actions.setTime(id, time),
    onDelete: () => actions.removeTask(id),
    onAddSubtask: (title: string) => actions.addSubtask(id, title),
    onToggleSubtask: (subtaskId: string) => actions.toggleSubtask(id, subtaskId),
    onRemoveSubtask: (subtaskId: string) => actions.removeSubtask(id, subtaskId),
  };
}

export function TaskItem({
  task,
  onToggle,
  onMemoChange,
  onTimeChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
}: {
  task: Task;
  onToggle: () => void;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const subtasks = task.subtasks ?? [];
  const doneCount = subtasks.filter((s) => s.done).length;

  return (
    <li>
      <div className="flex items-center gap-2">
        <Checkbox
          checked={task.done}
          onCheckedChange={onToggle}
          aria-label={`Toggle ${task.title}`}
        />
        {task.time && (
          <span className="shrink-0 text-xs tabular-nums text-subtle">
            {task.time}
          </span>
        )}
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
        {subtasks.length > 0 && (
          <span
            aria-label={`Subtasks: ${doneCount}/${subtasks.length}`}
            className="shrink-0 rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground"
          >
            {doneCount}/{subtasks.length}
          </span>
        )}
        {task.rolledFrom && (
          <RotateCw aria-label="Rolled over" className="size-3 shrink-0 text-subtle" />
        )}
      </div>
      {open && (
        <div className="mt-1 space-y-1.5 pl-6">
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={task.time ?? ""}
              onChange={(e) => onTimeChange(e.target.value || undefined)}
              aria-label="Task time"
              className="rounded-md border border-input bg-transparent px-1.5 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            {task.time && (
              <button
                type="button"
                onClick={() => onTimeChange(undefined)}
                className="text-xs text-subtle hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
          <textarea
            defaultValue={task.memo ?? ""}
            onBlur={(e) => onMemoChange(e.target.value)}
            placeholder="Memo"
            rows={2}
            className="w-full resize-none rounded-md border border-input bg-transparent p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <SubtaskList
            subtasks={subtasks}
            onAdd={onAddSubtask}
            onToggle={onToggleSubtask}
            onRemove={onRemoveSubtask}
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

`frontend/src/features/tasks/components/scope-tasks.tsx` (full replacement):

```tsx
"use client";

import { cn } from "@/lib/utils";

import { compareTasksForDay } from "../lib/times";
import { useTasks } from "../store";
import { scopeKey, type Scope } from "../types";
import { QuickAdd } from "./quick-add";
import { TaskItem, taskItemHandlers } from "./task-item";

export function ScopeTasks({
  scope,
  quickAdd = false,
  compact = false,
}: {
  scope: Scope;
  quickAdd?: boolean;
  compact?: boolean;
}) {
  const actions = useTasks();
  const { tasks, addTask } = actions;
  const key = scopeKey(scope);
  const scoped = tasks.filter((t) => scopeKey(t.scope) === key);
  const ordered =
    scope.kind === "day" ? [...scoped].sort(compareTasksForDay) : scoped;

  if (compact) {
    return (
      <ul className="space-y-0.5">
        {ordered.map((t) => {
          const subtasks = t.subtasks ?? [];
          const doneCount = subtasks.filter((s) => s.done).length;
          return (
            <li
              key={t.id}
              className={cn(
                "truncate text-xs text-muted-foreground",
                t.done && "line-through opacity-60",
              )}
            >
              {t.time && <span className="tabular-nums">{t.time} · </span>}
              {t.title}
              {subtasks.length > 0 && (
                <span className="tabular-nums"> · {doneCount}/{subtasks.length}</span>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="space-y-1">
      <ul className="space-y-1">
        {ordered.map((t) => (
          <TaskItem key={t.id} task={t} {...taskItemHandlers(t.id, actions)} />
        ))}
      </ul>
      {quickAdd && <QuickAdd onAdd={(title) => addTask(title, scope)} />}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/primitives.test.tsx`
Expected: PASS. Then run the whole suite (`npm test`) — the view tests must still pass (they render ScopeTasks/TaskItem through providers).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/components/subtask-list.tsx src/features/tasks/components/task-item.tsx src/features/tasks/components/scope-tasks.tsx src/features/tasks/components/primitives.test.tsx
git commit -m "feat: add subtask list, task time editing, and progress badges"
```

---

### Task 5: DayTimeline component

**Files:**
- Create: `frontend/src/features/tasks/components/day-timeline.tsx`
- Test: `frontend/src/features/tasks/components/day-timeline.test.tsx`

**Interfaces:**
- Consumes: `useTasks`; `scopeKey`, `Scope`; `todayKey` from `../lib/dates`; `compareTasksForDay`, `nowTime`, `timeToMinutes` from `../lib/times`; `TaskItem`, `taskItemHandlers`, `QuickAdd`.
- Produces: `DayTimeline({ date: string })` — connected component rendering:
  - all-day section (untimed tasks + QuickAdd)
  - scrollable hour rail (`data-testid="hour-rail"`, default scrolled to 07:00) with 24 hour lines, timed-task chips absolutely positioned at `timeToMinutes(time) * HOUR_HEIGHT / 60` px, and a now line (`data-testid="now-line"`) only when `date === todayKey()`
  - exports `HOUR_HEIGHT` (48) for tests.

- [ ] **Step 1: Write the failing tests**

`frontend/src/features/tasks/components/day-timeline.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { todayKey } from "../lib/dates";
import { TasksProvider } from "../store";
import { fakeRepository, makeTask } from "../test-utils";
import { DayTimeline, HOUR_HEIGHT } from "./day-timeline";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 6, 16, 14, 5)); // Thu 2026-07-16 14:05
});
afterAll(() => {
  vi.useRealTimers();
});

function renderTimeline(date: string, tasks = [] as Parameters<typeof fakeRepository>[0]) {
  return render(
    <TasksProvider repository={fakeRepository(tasks)}>
      <DayTimeline date={date} />
    </TasksProvider>,
  );
}

describe("DayTimeline", () => {
  it("splits all-day and timed tasks; chips sit at their hour offset", async () => {
    const day = todayKey();
    const untimed = makeTask({ id: "u", title: "untimed", scope: { kind: "day", date: day } });
    const timed = makeTask({
      id: "t",
      title: "dentist",
      time: "09:30",
      scope: { kind: "day", date: day },
    });
    renderTimeline(day, [untimed, timed]);

    await waitFor(() => expect(screen.getByText("untimed")).toBeTruthy());
    expect(screen.getByLabelText("Add task")).toBeTruthy();

    const chip = screen.getByTestId("chip-t");
    expect(chip.style.top).toBe(`${(570 * HOUR_HEIGHT) / 60}px`); // 09:30 = 570min
    expect(screen.getByText("dentist")).toBeTruthy();
  });

  it("shows the now line only on today, at the current time", async () => {
    const { unmount } = renderTimeline(todayKey());
    await waitFor(() => expect(screen.getByTestId("now-line")).toBeTruthy());
    const nowTop = (14 * 60 + 5) * (HOUR_HEIGHT / 60);
    expect(screen.getByTestId("now-line").style.top).toBe(`${nowTop}px`);
    unmount();

    renderTimeline("2026-07-15");
    await waitFor(() => expect(screen.getByLabelText("Add task")).toBeTruthy());
    expect(screen.queryByTestId("now-line")).toBeNull();
  });

  it("defaults the rail scroll to 07:00", async () => {
    renderTimeline(todayKey());
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(screen.getByTestId("hour-rail").scrollTop).toBe(7 * HOUR_HEIGHT);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/components/day-timeline.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `day-timeline.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";

import { todayKey } from "../lib/dates";
import { compareTasksForDay, nowTime, timeToMinutes } from "../lib/times";
import { useTasks } from "../store";
import { scopeKey, type Scope } from "../types";
import { QuickAdd } from "./quick-add";
import { TaskItem, taskItemHandlers } from "./task-item";

export const HOUR_HEIGHT = 48; // px per hour on the rail
const RAIL_HEIGHT = 24 * HOUR_HEIGHT;
const DEFAULT_SCROLL_HOUR = 7; // mornings visible by default

const toOffset = (time: string) => (timeToMinutes(time) * HOUR_HEIGHT) / 60;

export function DayTimeline({ date }: { date: string }) {
  const actions = useTasks();
  const { tasks, addTask } = actions;
  const scope: Scope = { kind: "day", date };
  const key = scopeKey(scope);
  const dayTasks = tasks.filter((t) => scopeKey(t.scope) === key);
  const allDay = dayTasks.filter((t) => !t.time);
  const timed = dayTasks.filter((t) => t.time).sort(compareTasksForDay);
  const isToday = date === todayKey();

  const railRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (railRef.current) {
      railRef.current.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_HEIGHT;
    }
  }, [date]);

  return (
    <div className="flex h-full flex-col gap-1.5">
      <div>
        <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-subtle">
          All-day
        </div>
        <ul className="space-y-1">
          {allDay.map((t) => (
            <TaskItem key={t.id} task={t} {...taskItemHandlers(t.id, actions)} />
          ))}
        </ul>
        <QuickAdd onAdd={(title) => addTask(title, scope)} />
      </div>

      <div
        ref={railRef}
        data-testid="hour-rail"
        className="relative max-h-96 min-h-48 overflow-y-auto rounded-md border border-border/60"
      >
        <div className="relative" style={{ height: RAIL_HEIGHT }}>
          {Array.from({ length: 24 }, (_, hour) => (
            <div
              key={hour}
              className="absolute inset-x-0 border-t border-border/40"
              style={{ top: hour * HOUR_HEIGHT }}
            >
              <span className="pl-1 text-[10px] tabular-nums text-subtle">
                {String(hour).padStart(2, "0")}:00
              </span>
            </div>
          ))}

          {isToday && (
            <div
              data-testid="now-line"
              className="absolute inset-x-0 z-10 border-t-2 border-brand"
              style={{ top: toOffset(nowTime()) }}
            />
          )}

          {timed.map((t) => (
            <div
              key={t.id}
              data-testid={`chip-${t.id}`}
              className="absolute inset-x-1 z-20 rounded-md bg-brand/10 px-1 ring-1 ring-brand/30"
              style={{ top: toOffset(t.time!) }}
            >
              <ul>
                <TaskItem task={t} {...taskItemHandlers(t.id, actions)} />
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/day-timeline.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/components/day-timeline.tsx src/features/tasks/components/day-timeline.test.tsx
git commit -m "feat: add day timeline with hour rail, chips, and now line"
```

---

### Task 6: DailyView rebuild + full verification

**Files:**
- Modify: `frontend/src/features/tasks/components/views/daily-view.tsx` (full rewrite below)
- Modify: `frontend/src/features/tasks/components/views/daily-view.test.tsx` (full rewrite below)

**Interfaces:**
- Consumes: `windowAround`, `weekdayOf`, `dayOfMonth`, `dayLabel`, `weekStartOf` from `../../lib/dates`; `DAY_LABELS`, `CalendarViewProps` from `./weekly-view`; `PeriodCell`, `ScopeTasks`, `DayTimeline`.
- Produces: `DailyView(props: CalendarViewProps)` — rolling 7-day window, focused day centered in a 2fr cell containing `DayTimeline`; neighbors faded/compact/clickable; Weekly cell pinned right bound to `weekStartOf(anchor)`.

- [ ] **Step 1: Rewrite the test file (failing first)**

`frontend/src/features/tasks/components/views/daily-view.test.tsx` (full replacement — the old Su–Sa strip assertions no longer apply):

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TasksProvider } from "../../store";
import { fakeRepository } from "../../test-utils";
import { DailyView } from "./daily-view";

const ANCHOR = "2026-07-16"; // Thursday

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 6, 16, 14, 5));
});
afterAll(() => {
  vi.useRealTimers();
});

function renderView(onAnchorChange = vi.fn()) {
  render(
    <TasksProvider repository={fakeRepository()}>
      <DailyView anchor={ANCHOR} onAnchorChange={onAnchorChange} />
    </TasksProvider>,
  );
  return onAnchorChange;
}

describe("DailyView v2", () => {
  it("renders the day heading and a centered rolling window Mo 13 .. Su 19", async () => {
    renderView();
    await waitFor(() =>
      expect(screen.getByText("Thursday, July 16")).toBeTruthy(),
    );
    // neighbors are faded buttons; the focused day is not a button
    const neighbors = screen.getAllByRole("button", { name: /^(Mo|Tu|We|Th|Fr|Sa|Su) \d+$/ });
    expect(neighbors.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Mo 13",
      "Tu 14",
      "We 15",
      "Fr 17",
      "Sa 18",
      "Su 19",
    ]);
    expect(screen.getByText("Th 16")).toBeTruthy();
  });

  it("the focused center holds the timeline; the Weekly cell is editable", async () => {
    renderView();
    await waitFor(() => expect(screen.getByTestId("hour-rail")).toBeTruthy());
    expect(screen.getByTestId("now-line")).toBeTruthy(); // anchor is today
    expect(screen.getByText("Weekly")).toBeTruthy();
    // two quick-adds: the timeline's all-day section + the weekly cell
    expect(screen.getAllByLabelText("Add task")).toHaveLength(2);
  });

  it("clicking a neighbor refocuses it, crossing the window", async () => {
    const onAnchorChange = renderView();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Mo 13" })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mo 13" }));
    expect(onAnchorChange).toHaveBeenCalledWith("2026-07-13");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/components/views/daily-view.test.tsx`
Expected: FAIL — old implementation renders the Su–Sa week strip, no hour rail.

- [ ] **Step 3: Rewrite `daily-view.tsx`**

```tsx
"use client";

import {
  dayLabel,
  dayOfMonth,
  weekdayOf,
  weekStartOf,
  windowAround,
} from "../../lib/dates";
import { DayTimeline } from "../day-timeline";
import { PeriodCell } from "../period-cell";
import { ScopeTasks } from "../scope-tasks";
import { DAY_LABELS, type CalendarViewProps } from "./weekly-view";

export function DailyView({ anchor, onAnchorChange }: CalendarViewProps) {
  const dates = windowAround(anchor);
  const weekStart = weekStartOf(anchor);

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">{dayLabel(anchor)}</h2>
      <div className="grid grid-cols-[repeat(3,1fr)_2fr_repeat(3,1fr)_1.5fr] gap-1">
        {dates.map((date) => {
          const focused = date === anchor;
          const label = `${DAY_LABELS[weekdayOf(date)]} ${dayOfMonth(date)}`;
          if (focused) {
            return (
              <div
                key={date}
                className="min-h-64 rounded-md bg-card p-1.5 ring-1 ring-ring/40"
              >
                <div className="mb-1 text-xs font-semibold">{label}</div>
                <DayTimeline date={date} />
              </div>
            );
          }
          return (
            <PeriodCell
              key={date}
              focused={false}
              onFocus={() => onAnchorChange(date)}
              aria-label={label}
              label={label}
              className="min-h-64 p-1.5"
            >
              <ScopeTasks scope={{ kind: "day", date }} compact />
            </PeriodCell>
          );
        })}
        <div className="min-h-64 rounded-md bg-muted/40 p-1.5">
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
Expected: PASS (3 tests).

- [ ] **Step 5: Full verification**

```bash
npm test        # entire suite green
npm run lint    # clean
npm run build   # compiles
```

Then run `npm run dev` and manually spot-check `http://localhost:10050/app` (requires login; if no session is available, note the manual check as deferred to the user):
1. Daily view: focused day centered and larger, hour rail scrolled to morning, now line on today.
2. Add an untimed task (all-day), give it a time via the expansion — it moves onto the rail.
3. Add subtasks to a task; check the badge updates; toggle/delete subtasks.
4. Click neighbors to refocus; ‹ › pages by a week; Today recenters.
5. Weekly view: timed task shows its `HH:MM ·` prefix; badges appear in compact rows.

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/components/views/daily-view.tsx src/features/tasks/components/views/daily-view.test.tsx
git commit -m "feat: rebuild daily view as centered rolling-window timeline"
```

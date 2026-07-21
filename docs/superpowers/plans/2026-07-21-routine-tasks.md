# Routine (Recurring) Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any day-scoped task be turned into a routine by picking which weekdays it repeats on. From then on, a fresh independent task auto-appears on each matching day, without cluttering the Weekly list with missed days.

**Architecture:** No new entity or repository. Two new optional fields on `Task` (`repeatWeekdays` on the "anchor" task that started the routine, `repeatSourceId` on each day auto-generated from it). A new pure function `materializeRoutines`, structurally parallel to the existing `rolloverTasks`, rides the exact same mount/day-change effect in the store. Generated occurrences are fully independent tasks from the moment they're created — editing or stopping a routine later never rewrites history.

**Tech Stack:** Next.js, React 19, TypeScript, Vitest + @testing-library/react, Tailwind.

**Working directory:** All file paths below are relative to `frontend/`.

## Global Constraints

- Weekday indices are `0`=Sun..`6`=Sat (JavaScript `Date.getDay()` convention) throughout.
- `repeatWeekdays` is set only on the anchor task (the task where repeat was first turned on); `repeatSourceId` is set only on a task generated from an anchor. A task is never both.
- Materialization happens only once a matching weekday becomes `todayKey()` — no pre-generation of future days, no backfill for days the app wasn't opened on.
- A generated occurrence copies the anchor's title/time/memo **as they are at generation time** and is never re-synced afterward — this is what makes "future occurrences reflect edits, past occurrences stay locked in" hold, with no extra propagation code.
- Unchecking every weekday on an anchor clears `repeatWeekdays` to `undefined` (store-layer normalization, the same pattern `setMemo` already uses for `memo.trim() || undefined`).
- Tasks with `repeatSourceId` set are exempt from rollover — `rolloverTasks` skips them entirely (in addition to its existing `done` skip). The anchor itself is not exempt.
- The "Repeat on" row/indicator is shown only for day-scoped tasks (`task.scope.kind === "day"`) — never for week/month/year-scoped tasks.
- A generated occurrence shows a read-only "Part of a routine" indicator instead of an editable picker; the pattern is only editable from the anchor's own day (no cross-task lookups anywhere in the UI).

---

### Task 1: Data model — type fields, `weekdayOf`, repository normalization

**Files:**
- Modify: `frontend/src/features/tasks/types.ts`
- Modify: `frontend/src/features/tasks/lib/dates.ts`
- Modify: `frontend/src/features/tasks/lib/dates.test.ts`
- Modify: `frontend/src/features/tasks/data/repository.ts`
- Modify: `frontend/src/features/tasks/data/repository.test.ts`

**Interfaces:**
- Produces: `Task.repeatWeekdays?: number[]`, `Task.repeatSourceId?: string`; `weekdayOf(dateKey: string): number` exported from `lib/dates.ts`. Consumed by Task 2 (`materializeRoutines`), Task 3 (`rolloverTasks`'s guard), Task 4 (store), Task 5/6 (UI).

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/lib/dates.test.ts`, add `weekdayOf` to the import list from `"./dates"` and add this test inside the existing `describe("dates", ...)` block:

```ts
  it("weekdayOf returns a getDay()-style index", () => {
    expect(weekdayOf("2026-07-16")).toBe(4); // Thursday
    expect(weekdayOf("2026-07-12")).toBe(0); // Sunday
  });
```

In `frontend/src/features/tasks/data/repository.test.ts`, add these cases inside the existing `describe("v2 field normalization", ...)` block, and replace the existing `"normalizeTask returns the same reference when nothing changed"` test with the version below (adds `repeatWeekdays` to `clean` so the reference-equality check also covers the new field):

```ts
  it("round-trips valid repeatWeekdays and repeatSourceId", async () => {
    const repo = createLocalStorageRepository(fakeStorage());
    const routine: Task = { ...task, id: "anchor", repeatWeekdays: [1, 3, 5] };
    const occurrence: Task = { ...task, id: "occ", repeatSourceId: "anchor" };
    await repo.create(routine);
    await repo.create(occurrence);
    expect(await repo.list()).toEqual([routine, occurrence]);
  });

  it("clears an invalid repeatWeekdays but keeps the task", async () => {
    const repo = createLocalStorageRepository(
      fakeStorage({
        "picking-up.tasks.v1": JSON.stringify([{ ...task, repeatWeekdays: [3, 9] }]),
      }),
    );
    const [loaded] = await repo.list();
    expect(loaded.id).toBe(task.id);
    expect(loaded.repeatWeekdays).toBeUndefined();
  });

  it("clears a non-string repeatSourceId but keeps the task", async () => {
    const repo = createLocalStorageRepository(
      fakeStorage({
        "picking-up.tasks.v1": JSON.stringify([{ ...task, repeatSourceId: 42 }]),
      }),
    );
    const [loaded] = await repo.list();
    expect(loaded.id).toBe(task.id);
    expect(loaded.repeatSourceId).toBeUndefined();
  });

  it("normalizeTask returns the same reference when nothing changed", () => {
    const clean: Task = {
      ...task,
      id: "clean",
      time: "09:30",
      subtasks: [{ id: "s1", title: "ok", done: false }],
      repeatWeekdays: [0, 6],
    };
    expect(normalizeTask(clean)).toBe(clean);
    const bare: Task = { ...task, id: "bare" };
    expect(normalizeTask(bare)).toBe(bare);
  });
```

(This replaces the prior version of the same-named test — delete the old one.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/lib/dates.test.ts src/features/tasks/data/repository.test.ts`
Expected: FAIL — `weekdayOf` doesn't exist yet, and the two "clears an invalid ..." tests fail because nothing strips malformed `repeatWeekdays`/`repeatSourceId` yet (they currently pass through unchanged via the existing spread in `normalizeTask`).

- [ ] **Step 3: Add the type fields**

In `frontend/src/features/tasks/types.ts`, add two fields to the `Task` interface (after the existing `time`/`subtasks` fields):

```ts
  repeatWeekdays?: number[]; // 0=Sun..6=Sat; set only on the anchor task
  repeatSourceId?: string;   // set only on a task generated from an anchor
```

- [ ] **Step 4: Add `weekdayOf` to `lib/dates.ts`**

Add this export in `frontend/src/features/tasks/lib/dates.ts`, right after `weekStartOf` (which already does the identical `parse(dateKey).getDay()` computation internally — this reuses that, not duplicates it):

```ts
export function weekdayOf(dateKey: string): number {
  return parse(dateKey).getDay();
}
```

- [ ] **Step 5: Add normalization to `repository.ts`**

In `frontend/src/features/tasks/data/repository.ts`, add this helper near `isSubtask`:

```ts
function isValidWeekdays(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
  );
}
```

Then update `normalizeTask` to also normalize the two new fields, and include them in the same-reference check:

```ts
export function normalizeTask(task: Task): Task {
  let time = task.time;
  if (time !== undefined && (typeof time !== "string" || !isValidTime(time))) {
    time = undefined;
  }

  let subtasks = task.subtasks;
  if (subtasks !== undefined) {
    if (Array.isArray(subtasks)) {
      const filtered = subtasks.filter(isSubtask);
      subtasks = filtered.length === subtasks.length ? subtasks : filtered;
    } else {
      subtasks = undefined;
    }
  }

  let repeatWeekdays = task.repeatWeekdays;
  if (repeatWeekdays !== undefined && !isValidWeekdays(repeatWeekdays)) {
    repeatWeekdays = undefined;
  }

  let repeatSourceId = task.repeatSourceId;
  if (repeatSourceId !== undefined && typeof repeatSourceId !== "string") {
    repeatSourceId = undefined;
  }

  if (
    time === task.time &&
    subtasks === task.subtasks &&
    repeatWeekdays === task.repeatWeekdays &&
    repeatSourceId === task.repeatSourceId
  ) {
    return task;
  }
  return { ...task, time, subtasks, repeatWeekdays, repeatSourceId };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/lib/dates.test.ts src/features/tasks/data/repository.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/features/tasks/types.ts src/features/tasks/lib/dates.ts src/features/tasks/lib/dates.test.ts src/features/tasks/data/repository.ts src/features/tasks/data/repository.test.ts
git commit -m "feat: add repeatWeekdays/repeatSourceId fields, weekdayOf, and their normalization"
```

---

### Task 2: `materializeRoutines`

**Files:**
- Create: `frontend/src/features/tasks/lib/routines.ts`
- Test: `frontend/src/features/tasks/lib/routines.test.ts`

**Interfaces:**
- Consumes: `weekdayOf(dateKey: string): number` from `./dates` (Task 1); `Task.repeatWeekdays`/`Task.repeatSourceId` (Task 1).
- Produces: `materializeRoutines(tasks: Task[], today: string): Task[]` — returns only the **new** occurrences to create (not the full merged array, unlike `rolloverTasks` which transforms in place). Consumed by Task 4 (store wiring).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/tasks/lib/routines.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { Task } from "../types";
import { materializeRoutines } from "./routines";

const TODAY = "2026-07-16"; // Thursday -> weekday index 4

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "anchor",
    title: "task",
    done: false,
    scope: { kind: "day", date: "2026-07-01" },
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("materializeRoutines", () => {
  it("creates today's occurrence when the weekday matches and none exists yet", () => {
    const anchor = makeTask({ repeatWeekdays: [4] });
    const [spawned] = materializeRoutines([anchor], TODAY);
    expect(spawned).toMatchObject({
      title: "task",
      done: false,
      scope: { kind: "day", date: TODAY },
      repeatSourceId: "anchor",
    });
  });

  it("copies the anchor's current title/time/memo at generation time", () => {
    const anchor = makeTask({
      repeatWeekdays: [4],
      title: "updated title",
      time: "08:00",
      memo: "updated memo",
    });
    const [spawned] = materializeRoutines([anchor], TODAY);
    expect(spawned.title).toBe("updated title");
    expect(spawned.time).toBe("08:00");
    expect(spawned.memo).toBe("updated memo");
  });

  it("does not duplicate if today's occurrence already exists", () => {
    const anchor = makeTask({ repeatWeekdays: [4] });
    const existing = makeTask({
      id: "occ1",
      scope: { kind: "day", date: TODAY },
      repeatSourceId: "anchor",
    });
    expect(materializeRoutines([anchor, existing], TODAY)).toEqual([]);
  });

  it("does not spawn a duplicate when the anchor itself is already scoped to today", () => {
    const anchor = makeTask({
      repeatWeekdays: [4],
      scope: { kind: "day", date: TODAY },
    });
    expect(materializeRoutines([anchor], TODAY)).toEqual([]);
  });

  it("ignores anchors whose weekday does not match today", () => {
    const anchor = makeTask({ repeatWeekdays: [1, 3, 5] }); // Mon/Wed/Fri, not Thu
    expect(materializeRoutines([anchor], TODAY)).toEqual([]);
  });

  it("ignores plain tasks with no repeatWeekdays", () => {
    const plain = makeTask({});
    expect(materializeRoutines([plain], TODAY)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/lib/routines.test.ts`
Expected: FAIL with a module-not-found error (`routines.ts` doesn't exist yet).

- [ ] **Step 3: Implement `materializeRoutines`**

Create `frontend/src/features/tasks/lib/routines.ts`:

```ts
import type { Task } from "../types";
import { weekdayOf } from "./dates";

export function materializeRoutines(tasks: Task[], today: string): Task[] {
  const todayWeekday = weekdayOf(today);

  const anchors = tasks.filter(
    (t): t is Task & { repeatWeekdays: number[] } =>
      t.repeatWeekdays !== undefined && t.repeatWeekdays.includes(todayWeekday),
  );

  return anchors
    .filter((anchor) => {
      // The anchor's own day already covers `today` if that's where it lives —
      // without this check, the very day repeat is turned on would spawn a
      // second, duplicate occurrence alongside the anchor itself.
      if (anchor.scope.kind === "day" && anchor.scope.date === today) return false;
      return !tasks.some(
        (t) =>
          t.repeatSourceId === anchor.id &&
          t.scope.kind === "day" &&
          t.scope.date === today,
      );
    })
    .map((anchor) => ({
      id: crypto.randomUUID(),
      title: anchor.title,
      memo: anchor.memo,
      time: anchor.time,
      done: false,
      scope: { kind: "day", date: today },
      repeatSourceId: anchor.id,
      createdAt: new Date().toISOString(),
    }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/lib/routines.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/lib/routines.ts src/features/tasks/lib/routines.test.ts
git commit -m "feat: add materializeRoutines"
```

---

### Task 3: Rollover exemption for routine occurrences

**Files:**
- Modify: `frontend/src/features/tasks/lib/rollover.ts`
- Modify: `frontend/src/features/tasks/lib/rollover.test.ts`

**Interfaces:**
- Consumes: `Task.repeatSourceId` (Task 1). `rolloverTasks`'s signature is unchanged.

- [ ] **Step 1: Write the failing test**

Add this test to the existing `describe("rolloverTasks", ...)` block in `frontend/src/features/tasks/lib/rollover.test.ts`:

```ts
  it("never rolls a routine occurrence, even once its day has passed", () => {
    const task = makeTask({
      scope: { kind: "day", date: "2026-07-01" },
      repeatSourceId: "anchor-1",
    });
    const [result] = rolloverTasks([task], TODAY);
    expect(result).toBe(task); // untouched, same reference
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/tasks/lib/rollover.test.ts`
Expected: FAIL — the task currently rolls into the current week's Weekly cell like any other past day task.

- [ ] **Step 3: Add the exemption guard**

In `frontend/src/features/tasks/lib/rollover.ts`, add one line right after the existing `done` check:

```ts
  return tasks.map((task) => {
    if (task.done) return task;
    if (task.repeatSourceId !== undefined) return task;

    let scope = task.scope;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/tasks/lib/rollover.test.ts`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/lib/rollover.ts src/features/tasks/lib/rollover.test.ts
git commit -m "feat: exempt routine occurrences from rollover"
```

---

### Task 4: Store wiring — materialization + `setRepeatWeekdays`

**Files:**
- Modify: `frontend/src/features/tasks/store.tsx`
- Modify: `frontend/src/features/tasks/store.test.tsx`

**Interfaces:**
- Consumes: `materializeRoutines(tasks, today): Task[]` (Task 2).
- Produces: `setRepeatWeekdays(id: string, weekdays: number[] | undefined): void` on `TasksContextValue`. Consumed by Task 7 (`taskItemHandlers`).

- [ ] **Step 1: Write the failing tests**

Add this new `describe` block to `frontend/src/features/tasks/store.test.tsx`, inside `describe("TasksProvider", ...)` (after the existing `describe("rollover on date change (not just mount)", ...)` block):

```tsx
  describe("routines", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("materializes today's occurrence for a matching anchor on load", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 6, 16)); // Thursday, weekday 4
      const anchor = makeTask({
        id: "anchor",
        scope: { kind: "day", date: "2026-07-01" },
        repeatWeekdays: [4],
      });
      const { repo, result } = setup(fakeRepository([anchor]));

      await waitFor(() => expect(result.current.loaded).toBe(true));
      const spawned = result.current.tasks.find((t) => t.repeatSourceId === "anchor");
      expect(spawned).toMatchObject({
        title: "task",
        scope: { kind: "day", date: "2026-07-16" },
      });
      await waitFor(() =>
        expect(repo.tasks.some((t) => t.repeatSourceId === "anchor")).toBe(true),
      );
    });

    it("materializes a new occurrence when the date changes while the tab stays open", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 6, 15)); // Wednesday, weekday 3 — not matching yet
      const anchor = makeTask({
        id: "anchor",
        scope: { kind: "day", date: "2026-07-01" },
        repeatWeekdays: [4], // Thursday
      });
      const { repo, result } = setup(fakeRepository([anchor]));
      await waitFor(() => expect(result.current.loaded).toBe(true));
      expect(result.current.tasks.some((t) => t.repeatSourceId === "anchor")).toBe(false);

      act(() => {
        vi.setSystemTime(new Date(2026, 6, 16)); // Thursday
        document.dispatchEvent(new Event("visibilitychange"));
      });

      await waitFor(() =>
        expect(result.current.tasks.some((t) => t.repeatSourceId === "anchor")).toBe(true),
      );
      await waitFor(() =>
        expect(repo.tasks.some((t) => t.repeatSourceId === "anchor")).toBe(true),
      );
    });

    it("setRepeatWeekdays sets, then clears to undefined when weekdays is empty", async () => {
      const task = makeTask({ id: "a", scope: { kind: "day", date: todayKey() } });
      const { repo, result } = setup(fakeRepository([task]));
      await waitFor(() => expect(result.current.loaded).toBe(true));

      act(() => result.current.setRepeatWeekdays("a", [1, 3, 5]));
      expect(result.current.tasks[0].repeatWeekdays).toEqual([1, 3, 5]);
      await waitFor(() => expect(repo.tasks[0].repeatWeekdays).toEqual([1, 3, 5]));

      act(() => result.current.setRepeatWeekdays("a", []));
      expect(result.current.tasks[0].repeatWeekdays).toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/store.test.tsx`
Expected: FAIL — `materializeRoutines` isn't wired into the store yet (no occurrence ever appears), and `result.current.setRepeatWeekdays` is not a function.

- [ ] **Step 3: Wire materialization and add `setRepeatWeekdays`**

In `frontend/src/features/tasks/store.tsx`, add the import:

```ts
import { materializeRoutines } from "./lib/routines";
```

Update the mount effect:

```ts
  useEffect(() => {
    let cancelled = false;
    void repo.list().then((tasks) => {
      if (cancelled) return;
      const today = todayKey();
      const rolled = rolloverTasks(tasks, today);
      const spawned = materializeRoutines(rolled, today);
      const finalTasks = [...rolled, ...spawned];
      dispatch({ type: "loaded", tasks: finalTasks });
      appliedDayRef.current = today;
      rolled.forEach((task, i) => {
        if (task !== tasks[i]) void repo.update(task);
      });
      spawned.forEach((task) => void repo.create(task));
    });
    return () => {
      cancelled = true;
    };
  }, [repo]);
```

Update the day-change effect's inner function the same way:

```ts
    function rolloverIfDateChanged() {
      if (appliedDayRef.current === null) return;
      const today = todayKey();
      if (today === appliedDayRef.current) return;
      const tasks = tasksRef.current;
      const rolled = rolloverTasks(tasks, today);
      const spawned = materializeRoutines(rolled, today);
      const finalTasks = [...rolled, ...spawned];
      dispatch({ type: "loaded", tasks: finalTasks });
      appliedDayRef.current = today;
      rolled.forEach((task, i) => {
        if (task !== tasks[i]) void repo.update(task);
      });
      spawned.forEach((task) => void repo.create(task));
    }
```

Add to the `TasksContextValue` interface:

```ts
  setRepeatWeekdays: (id: string, weekdays: number[] | undefined) => void;
```

Add to the `value` object (next to `setTime`):

```ts
      setRepeatWeekdays(id, weekdays) {
        const current = state.tasks.find((t) => t.id === id);
        if (!current) return;
        const normalized = weekdays && weekdays.length > 0 ? weekdays : undefined;
        const task: Task = { ...current, repeatWeekdays: normalized };
        dispatch({ type: "updated", task });
        void repo.update(task);
      },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/store.test.tsx`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/store.tsx src/features/tasks/store.test.tsx
git commit -m "feat: wire routine materialization and setRepeatWeekdays into the store"
```

---

### Task 5: `TaskRepeatPicker` component

**Files:**
- Create: `frontend/src/features/tasks/components/task-repeat-picker.tsx`
- Test: `frontend/src/features/tasks/components/task-repeat-picker.test.tsx`

**Interfaces:**
- Produces: `TaskRepeatPicker({ weekdays, onChange }: { weekdays: number[]; onChange: (weekdays: number[]) => void })`. Consumed by Task 6 (`TaskDetailFields`).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/tasks/components/task-repeat-picker.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskRepeatPicker } from "./task-repeat-picker";

describe("TaskRepeatPicker", () => {
  it("renders seven weekday toggles, reflecting which are active", () => {
    render(<TaskRepeatPicker weekdays={[1, 3, 5]} onChange={() => {}} />);
    expect(screen.getByLabelText("Repeat on Monday").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Repeat on Wednesday").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Repeat on Friday").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Repeat on Sunday").getAttribute("aria-pressed")).toBe("false");
  });

  it("calls onChange with the day added when toggling an inactive day", () => {
    const onChange = vi.fn();
    render(<TaskRepeatPicker weekdays={[1]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Repeat on Wednesday"));
    expect(onChange).toHaveBeenCalledWith([1, 3]);
  });

  it("calls onChange with the day removed when toggling an active day", () => {
    const onChange = vi.fn();
    render(<TaskRepeatPicker weekdays={[1, 3, 5]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Repeat on Wednesday"));
    expect(onChange).toHaveBeenCalledWith([1, 5]);
  });

  it("calls onChange with an empty array when unchecking the last active day", () => {
    const onChange = vi.fn();
    render(<TaskRepeatPicker weekdays={[4]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Repeat on Thursday"));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/components/task-repeat-picker.test.tsx`
Expected: FAIL with a module-not-found error (`task-repeat-picker.tsx` doesn't exist yet).

- [ ] **Step 3: Create `TaskRepeatPicker`**

Create `frontend/src/features/tasks/components/task-repeat-picker.tsx`:

```tsx
"use client";

import { cn } from "@/lib/utils";

const WEEKDAYS = [
  { label: "Su", fullName: "Sunday" },
  { label: "Mo", fullName: "Monday" },
  { label: "Tu", fullName: "Tuesday" },
  { label: "We", fullName: "Wednesday" },
  { label: "Th", fullName: "Thursday" },
  { label: "Fr", fullName: "Friday" },
  { label: "Sa", fullName: "Saturday" },
];

export function TaskRepeatPicker({
  weekdays,
  onChange,
}: {
  weekdays: number[];
  onChange: (weekdays: number[]) => void;
}) {
  const toggle = (day: number) => {
    const next = weekdays.includes(day)
      ? weekdays.filter((d) => d !== day)
      : [...weekdays, day].sort((a, b) => a - b);
    onChange(next);
  };

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Repeat on">
      {WEEKDAYS.map(({ label, fullName }, day) => {
        const active = weekdays.includes(day);
        return (
          <button
            key={day}
            type="button"
            onClick={() => toggle(day)}
            aria-pressed={active}
            aria-label={`Repeat on ${fullName}`}
            className={cn(
              "flex size-6 items-center justify-center rounded-md text-[10px] font-medium",
              active
                ? "bg-brand text-primary-foreground"
                : "bg-muted text-subtle hover:bg-muted/70",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/task-repeat-picker.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/components/task-repeat-picker.tsx src/features/tasks/components/task-repeat-picker.test.tsx
git commit -m "feat: add TaskRepeatPicker"
```

---

### Task 6: `TaskDetailFields` — repeat row

**Files:**
- Modify: `frontend/src/features/tasks/components/task-detail-fields.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-fields.test.tsx`

**Interfaces:**
- Consumes: `TaskRepeatPicker` (Task 5).
- Produces: `TaskDetailFields` gains a required `onRepeatWeekdaysChange: (weekdays: number[]) => void` prop. Consumed by Task 7 (`TaskItem`, `TaskDetailPanel`).

- [ ] **Step 1: Write the failing tests**

Add `fireEvent` and `vi` to the existing import from `"@testing-library/react"` / `"vitest"` in `frontend/src/features/tasks/components/task-detail-fields.test.tsx`, add `onRepeatWeekdaysChange: (_weekdays: number[]) => {},` to `noopHandlers`, and append this new `describe` block:

```tsx
describe("TaskDetailFields repeat", () => {
  it("shows an editable repeat picker for a day-scoped task with no routine yet", () => {
    render(
      <TaskDetailFields
        task={makeTask({ scope: { kind: "day", date: "2026-07-16" } })}
        {...noopHandlers}
      />,
    );
    expect(screen.getByLabelText("Repeat on Monday")).toBeTruthy();
  });

  it("shows a read-only indicator instead of the picker for a generated occurrence", () => {
    render(
      <TaskDetailFields
        task={makeTask({
          scope: { kind: "day", date: "2026-07-16" },
          repeatSourceId: "anchor-1",
        })}
        {...noopHandlers}
      />,
    );
    expect(screen.queryByLabelText("Repeat on Monday")).toBeNull();
    expect(screen.getByLabelText("Part of a routine")).toBeTruthy();
  });

  it("hides the repeat row entirely for a non-day-scoped task", () => {
    render(
      <TaskDetailFields
        task={makeTask({ scope: { kind: "week", weekStart: "2026-07-12" } })}
        {...noopHandlers}
      />,
    );
    expect(screen.queryByLabelText("Repeat on Monday")).toBeNull();
    expect(screen.queryByLabelText("Part of a routine")).toBeNull();
  });

  it("calls onRepeatWeekdaysChange when toggling a day", () => {
    const onRepeatWeekdaysChange = vi.fn();
    render(
      <TaskDetailFields
        task={makeTask({
          scope: { kind: "day", date: "2026-07-16" },
          repeatWeekdays: [1],
        })}
        {...noopHandlers}
        onRepeatWeekdaysChange={onRepeatWeekdaysChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Repeat on Wednesday"));
    expect(onRepeatWeekdaysChange).toHaveBeenCalledWith([1, 3]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/components/task-detail-fields.test.tsx`
Expected: FAIL — no repeat row exists yet.

- [ ] **Step 3: Add the repeat row to `TaskDetailFields`**

Replace the full contents of `frontend/src/features/tasks/components/task-detail-fields.tsx`:

```tsx
"use client";

import { RotateCw } from "lucide-react";

import type { Task } from "../types";
import { SubtaskList } from "./subtask-list";
import { TaskRepeatPicker } from "./task-repeat-picker";
import { TaskTimeEditor } from "./task-time-editor";

export function TaskDetailFields({
  task,
  onMemoChange,
  onTimeChange,
  onRepeatWeekdaysChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
  showTime = true,
}: {
  task: Task;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onRepeatWeekdaysChange: (weekdays: number[]) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
  showTime?: boolean;
}) {
  const subtasks = task.subtasks ?? [];
  return (
    <div className="space-y-1.5">
      {showTime && <TaskTimeEditor time={task.time} onTimeChange={onTimeChange} />}
      {task.scope.kind === "day" &&
        (task.repeatSourceId !== undefined ? (
          <span className="flex items-center gap-1 text-xs text-subtle">
            <RotateCw aria-label="Part of a routine" className="size-3" />
            Part of a routine
          </span>
        ) : (
          <TaskRepeatPicker
            weekdays={task.repeatWeekdays ?? []}
            onChange={onRepeatWeekdaysChange}
          />
        ))}
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
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/task-detail-fields.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/tasks/components/task-detail-fields.tsx src/features/tasks/components/task-detail-fields.test.tsx
git commit -m "feat: add repeat-on row to TaskDetailFields"
```

---

### Task 7: Thread `onRepeatWeekdaysChange` through `TaskItem` and `TaskDetailPanel`

**Files:**
- Modify: `frontend/src/features/tasks/components/task-item.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-panel.tsx`
- Modify: `frontend/src/features/tasks/components/primitives.test.tsx`
- Modify: `frontend/src/features/tasks/components/task-detail-panel.test.tsx`

**Interfaces:**
- Consumes: `setRepeatWeekdays` on `TasksContextValue` (Task 4); `TaskDetailFields`'s `onRepeatWeekdaysChange` prop (Task 6).
- Produces: `taskItemHandlers(id, actions)` includes `onRepeatWeekdaysChange` in its returned object — `ScopeTasks`, `DayTimeline`, and `DailyView` all spread this helper's return value already (`{...taskItemHandlers(id, actions)}`), so they need no changes of their own to pick up the new prop.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/features/tasks/components/primitives.test.tsx`, add `onRepeatWeekdaysChange: (_weekdays: number[]) => {},` to the file's `noopHandlers` object, and add this test inside the existing `describe("TaskItem v2", ...)` block:

```tsx
  it("toggles repeat weekdays from the expansion", () => {
    const onRepeatWeekdaysChange = vi.fn();
    render(
      <TaskItem
        task={makeTask({ title: "dentist" })}
        {...noopHandlers}
        onRepeatWeekdaysChange={onRepeatWeekdaysChange}
      />,
    );
    fireEvent.click(screen.getByText("dentist"));
    fireEvent.click(screen.getByLabelText("Repeat on Wednesday"));
    expect(onRepeatWeekdaysChange).toHaveBeenCalledWith([3]);
  });
```

In `frontend/src/features/tasks/components/task-detail-panel.test.tsx`, add `onRepeatWeekdaysChange: (_weekdays: number[]) => {},` to the file's `noopHandlers` object, and add this test inside the existing `describe("TaskDetailPanel", ...)` block:

```tsx
  it("shows the repeat picker for a day-scoped task with no routine yet", () => {
    render(<TaskDetailPanel task={task} {...noopHandlers} />);
    expect(screen.getByLabelText("Repeat on Monday")).toBeTruthy();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/tasks/components/primitives.test.tsx src/features/tasks/components/task-detail-panel.test.tsx`
Expected: FAIL — `TaskItem` and `TaskDetailPanel` don't accept or forward `onRepeatWeekdaysChange` yet, so `TaskDetailFields` never receives it and the repeat row never renders.

- [ ] **Step 3: Thread the prop through both components**

In `frontend/src/features/tasks/components/task-item.tsx`, add to the `TaskItemActions` interface:

```ts
  setRepeatWeekdays: (id: string, weekdays: number[] | undefined) => void;
```

Add to `taskItemHandlers`'s returned object:

```ts
    onRepeatWeekdaysChange: (weekdays: number[]) => actions.setRepeatWeekdays(id, weekdays),
```

Add `onRepeatWeekdaysChange` to `TaskItem`'s props destructure and type, and pass it to `TaskDetailFields`:

```tsx
export function TaskItem({
  task,
  dateLabel,
  onToggle,
  onMemoChange,
  onTimeChange,
  onRepeatWeekdaysChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
  onSelect,
}: {
  task: Task;
  dateLabel?: string;
  onToggle: () => void;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onRepeatWeekdaysChange: (weekdays: number[]) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
  onSelect?: () => void;
}) {
```

```tsx
      {open && (
        <div className="mt-1 pl-6">
          <TaskDetailFields
            task={task}
            onMemoChange={onMemoChange}
            onTimeChange={onTimeChange}
            onRepeatWeekdaysChange={onRepeatWeekdaysChange}
            onDelete={onDelete}
            onAddSubtask={onAddSubtask}
            onToggleSubtask={onToggleSubtask}
            onRemoveSubtask={onRemoveSubtask}
          />
        </div>
      )}
```

In `frontend/src/features/tasks/components/task-detail-panel.tsx`, add `onRepeatWeekdaysChange` to `TaskDetailPanel`'s props destructure and type, and pass it to `TaskDetailFields`:

```tsx
export function TaskDetailPanel({
  task,
  onToggle,
  onClose,
  onMemoChange,
  onTimeChange,
  onRepeatWeekdaysChange,
  onDelete,
  onAddSubtask,
  onToggleSubtask,
  onRemoveSubtask,
}: {
  task: Task;
  onToggle: () => void;
  onClose: () => void;
  onMemoChange: (memo: string) => void;
  onTimeChange: (time?: string) => void;
  onRepeatWeekdaysChange: (weekdays: number[]) => void;
  onDelete: () => void;
  onAddSubtask: (title: string) => void;
  onToggleSubtask: (subtaskId: string) => void;
  onRemoveSubtask: (subtaskId: string) => void;
}) {
```

```tsx
      <TaskDetailFields
        task={task}
        onMemoChange={onMemoChange}
        onTimeChange={onTimeChange}
        onRepeatWeekdaysChange={onRepeatWeekdaysChange}
        onDelete={onDelete}
        onAddSubtask={onAddSubtask}
        onToggleSubtask={onToggleSubtask}
        onRemoveSubtask={onRemoveSubtask}
        showTime={false}
      />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/tasks/components/primitives.test.tsx src/features/tasks/components/task-detail-panel.test.tsx`
Expected: PASS (all tests in both files)

- [ ] **Step 5: Full frontend test suite and manual check**

Run: `npx vitest run`
Expected: PASS across the whole suite.

Then manually verify in the browser (`npm run dev` from `frontend/`, Daily tab): open a day task's detail, toggle a couple of weekdays on, confirm it doesn't roll into the Weekly list once its day passes (or fast-forward the system clock in devtools), and confirm that once a matching weekday is reached, a fresh independent copy of the task appears that day.

- [ ] **Step 6: Commit**

```bash
git add src/features/tasks/components/task-item.tsx src/features/tasks/components/task-detail-panel.tsx src/features/tasks/components/primitives.test.tsx src/features/tasks/components/task-detail-panel.test.tsx
git commit -m "feat: thread repeat-weekdays wiring through TaskItem and TaskDetailPanel"
```

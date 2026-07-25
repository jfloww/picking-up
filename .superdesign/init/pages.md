# Page Dependency Trees

Tests, test utilities, backend-only modules, and API route handlers are omitted. These are candidate trees for visual context; select only UI-bearing files for design commands.

## `/` — Home

Entry: `frontend/src/app/page.tsx`

Dependencies:
- `frontend/src/components/site-header.tsx`
  - `frontend/src/components/wordmark.tsx`
    - `frontend/src/lib/utils.ts`
  - `frontend/src/components/theme-toggle.tsx`
    - `frontend/src/components/ui/button.tsx`
      - `frontend/src/lib/utils.ts`
  - `frontend/src/features/auth/components/logout-button.tsx`
    - `frontend/src/components/ui/button.tsx`
  - `frontend/src/features/auth/types.ts`
  - `frontend/src/lib/utils.ts`
- `frontend/src/components/task-mock.tsx`
  - `frontend/src/lib/utils.ts`
- `frontend/src/components/site-footer.tsx`
  - `frontend/src/components/wordmark.tsx`
  - `frontend/src/components/ui/button.tsx`
  - `frontend/src/lib/utils.ts`
- `frontend/src/components/ui/button.tsx`
- `frontend/src/features/auth/api/auth.ts` (data only; omit from visual context)
- `frontend/src/lib/utils.ts`

## `/app` — Task Planner

Entry: `frontend/src/app/app/page.tsx`

Dependencies:
- `frontend/src/components/site-header.tsx`
  - `frontend/src/components/wordmark.tsx`
  - `frontend/src/components/theme-toggle.tsx`
  - `frontend/src/features/auth/components/logout-button.tsx`
  - `frontend/src/components/ui/button.tsx`
  - `frontend/src/lib/utils.ts`
- `frontend/src/features/tasks/components/task-calendar.tsx`
  - `frontend/src/features/tasks/store.tsx`
    - `frontend/src/features/tasks/data/repository.ts`
    - `frontend/src/features/tasks/lib/dates.ts`
    - `frontend/src/features/tasks/lib/times.ts`
    - `frontend/src/features/tasks/lib/rollover.ts`
    - `frontend/src/features/tasks/lib/routines.ts`
    - `frontend/src/features/tasks/types.ts`
  - `frontend/src/features/tasks/components/view-switcher.tsx`
    - `frontend/src/components/ui/button.tsx`
    - `frontend/src/lib/utils.ts`
  - `frontend/src/features/tasks/components/views/daily-view.tsx`
    - `frontend/src/features/tasks/components/day-agenda.tsx`
      - `frontend/src/features/tasks/components/quick-add.tsx`
      - `frontend/src/features/tasks/components/task-item.tsx`
        - `frontend/src/components/ui/checkbox.tsx`
        - `frontend/src/features/tasks/components/task-detail-fields.tsx`
          - `frontend/src/features/tasks/components/subtask-list.tsx`
          - `frontend/src/features/tasks/components/task-repeat-picker.tsx`
          - `frontend/src/features/tasks/components/task-time-editor.tsx`
    - `frontend/src/features/tasks/components/day-timeline.tsx`
      - `frontend/src/features/tasks/components/task-item.tsx`
    - `frontend/src/features/tasks/components/task-detail-drawer.tsx`
      - `frontend/src/components/ui/checkbox.tsx`
      - `frontend/src/features/tasks/components/task-detail-fields.tsx`
      - `frontend/src/features/tasks/components/task-time-editor.tsx`
    - `frontend/src/features/tasks/components/use-drag-to-schedule.ts`
  - `frontend/src/features/tasks/components/views/weekly-view.tsx`
    - `frontend/src/features/tasks/components/scope-tasks.tsx`
      - `frontend/src/features/tasks/components/quick-add.tsx`
      - `frontend/src/features/tasks/components/task-item.tsx`
    - `frontend/src/features/tasks/components/task-detail-panel.tsx`
      - `frontend/src/components/ui/checkbox.tsx`
      - `frontend/src/features/tasks/components/task-detail-fields.tsx`
  - `frontend/src/features/tasks/components/views/monthly-view.tsx`
    - `frontend/src/features/tasks/components/views/year-grid.tsx`
      - `frontend/src/features/tasks/components/period-cell.tsx`
      - `frontend/src/features/tasks/components/scope-tasks.tsx`
  - `frontend/src/features/tasks/components/views/yearly-view.tsx`
    - `frontend/src/features/tasks/components/views/year-grid.tsx`
- `frontend/src/components/site-footer.tsx`
  - `frontend/src/components/wordmark.tsx`
  - `frontend/src/components/ui/button.tsx`
  - `frontend/src/lib/utils.ts`
- `frontend/src/features/auth/api/auth.ts` (data only; omit from visual context)

## `/login` — Login

Entry: `frontend/src/app/login/page.tsx`

Dependencies:
- `frontend/src/components/auth-layout.tsx`
  - `frontend/src/components/wordmark.tsx`
  - `frontend/src/components/theme-toggle.tsx`
    - `frontend/src/components/ui/button.tsx`
- `frontend/src/features/auth/components/auth-form.tsx`
  - `frontend/src/components/ui/alert.tsx`
  - `frontend/src/components/ui/button.tsx`
  - `frontend/src/components/ui/input.tsx`
  - `frontend/src/components/ui/label.tsx`
  - `frontend/src/features/auth/types.ts`
- `frontend/src/lib/utils.ts`

## `/signup` — Signup

Entry: `frontend/src/app/signup/page.tsx`

Dependencies are the same as `/login`, with `AuthForm` rendered in signup mode.

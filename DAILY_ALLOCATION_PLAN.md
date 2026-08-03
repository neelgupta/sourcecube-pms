# Daily Task Allocation — Current Flow vs. Planned Flow

## Context

The Resources planner (`server/src/routes/resources.ts`, `SCT-PMS/src/features/resources/ResourcesPage.tsx`) shows each employee's daily capacity (from a tenant-wide `WorkingSchedule`, e.g. 8.5h/day) against "planned" hours per task. Today that "planned" number is never actually chosen by anyone — it's silently computed by dividing each task's `estimatedMinutes` evenly across every working day between the task's `startDate` and `dueDate`.

This doesn't match how people actually work: an employee with Task A (15h estimate) and Task B (10h estimate) both active this week doesn't spend equal time on both every day — they might do 6h on A and 2h on B today, then flip the ratio tomorrow. The goal is to let employees explicitly plan/split their own daily capacity across their assigned tasks, informed by (but not constrained by) each task's dates, with the system falling back to the current auto-split wherever no explicit choice has been made.

---

## Current Flow (as implemented today)

### How "planned hours" are computed
- Each task has `estimatedMinutes`, `startDate`, `dueDate`, `assigneeId`.
- `taskDateSpan()` (resources.ts:67-75) builds the list of working days between a task's `startDate` and `dueDate`.
- For any given day, a task's contribution to "planned minutes" is `Math.round(task.estimatedMinutes / span.length)` — i.e. the estimate divided evenly across every working day in its window.
- This is computed fresh on every request. Nothing is stored; there is no way for a user to override it.

### Capacity
- Capacity is **not per-employee** — it comes from one tenant-wide `WorkingSchedule` record (`startTime`, `endTime`, `breakMinutes`, `workingDays`), converted to minutes via `minutesBetween()`. Every employee sees the same daily capacity (e.g. 8.5h) on a given working day.

### Endpoints
- `GET /resources/planner?start=&end=` — grid of employees × date range. Each day cell = `{ taskCount, plannedMinutes, trackedSeconds, plannedTrackedSeconds, extraPlannedSeconds, unplannedTrackedSeconds, remainingPlannedMinutes }`, all derived from the uniform-split formula above plus actual logged time (`TaskTimeEntry`).
- `GET /resources/planner/:employeeId/day?date=` — single-day drill-down: same plan-vs-tracked metrics, plus the list of tasks active that day (each with its computed `plannedMinutes`) and the raw time-entry logs.

### Frontend (`ResourcesPage.tsx`)
- Renders the grid: employees × days, each cell shows tracked/capacity hours with a green/amber/red load bar plus "Xh planned" and task count.
- Clicking a day cell opens `DayDetailPanel` — shows the day's stats and a **read-only** list of tasks with their auto-computed planned minutes for that day.
- `AssignTaskSection` lets a manager assign an existing/new task to an employee for a date, but this only sets `assigneeId`/`dueDate` on the task — it has no effect on how hours are split, which is still auto-computed afterward.

### Who can see what
- `resourceUserScope()` gates visibility: elevated roles (super admin, HR admin, auditor) see everyone; `team_lead`/`department_head`/`project_manager` see their scoped subset; everyone else (including `employee`) sees only themselves.
- Permission matrix: `resources` module currently only grants `"view"` to the `employee` role — no write/edit action exists for this module at all today.

### Limitation this plan addresses
There is no way for anyone — employee or manager — to say "today I'm doing 6h on Task A and 2h on Task B" instead of the system's even split. The number shown is always a mechanical average, never a real plan.

---

## Planned Flow (after implementing the plan)

### New data: `TaskDailyAllocation`
A new Prisma model stores an explicit choice: for a given `(task, user, date)`, how many minutes were planned.

```prisma
model TaskDailyAllocation {
  id             String      @id @default(cuid())
  tenantId       String
  company        Company     @relation(fields: [tenantId], references: [id])
  taskId         String
  task           ProjectTask @relation("TaskAllocations", fields: [taskId], references: [id], onDelete: Cascade)
  userId         String
  user           CompanyUser @relation("TaskAllocationsForUser", fields: [userId], references: [id], onDelete: Cascade)
  date           DateTime    @db.Date
  plannedMinutes Int
  note           String?
  createdBy      String?
  updatedBy      String?
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  @@unique([taskId, userId, date])
  @@index([tenantId, userId, date])
  @@index([tenantId, taskId])
}
```

- `userId` is denormalized from `task.assigneeId` at write time, so history survives a later reassignment.
- `plannedMinutes = 0` is treated as "delete this row," not stored, to keep the table lean.
- No DB-level capacity constraint — over-allocating a day is a **soft warning only**, computed at read time, never blocked.
- Capacity stays tenant-wide via `WorkingSchedule` for v1 — no per-employee capacity field added (explicitly deferred, see Fast-follows).
- Purely additive: one new table, no existing columns touched, no backfill needed (rows with no explicit allocation keep using the exact same fallback formula as today).

### New/changed backend endpoints

| Endpoint | Purpose |
|---|---|
| `GET /resources/planner/:employeeId/allocations?start=&end=` | Raw allocation rows for a date range (hydration). |
| `PUT /resources/planner/:employeeId/day/:date/allocations` | Whole-day replace: employee (or in-scope manager) submits their full split for one day across however many tasks; transactionally upserts/deletes rows to match. Returns the fresh day-detail payload. |
| `GET /resources/planner/:employeeId/day` *(modified)* | Now prefers a stored allocation's `plannedMinutes` over the uniform-split formula, per task per day. Adds `hasExplicitAllocation` and `withinTaskWindow` flags per task. Includes tasks allocated outside their normal date window too. |
| `GET /resources/planner` *(modified)* | Grid cells now prefer stored allocations the same way — no response shape change, just more accurate numbers. |

**Validation on write:** the task must belong to the tenant and be assigned to the target employee (rejects allocating against someone else's task); no hard block on allocating outside a task's `startDate`/`dueDate` (flagged as a warning instead); every read/write scoped by `tenantId` and by `resourceUserScope` (same rule that already gates planner visibility today — self, or a manager/lead/PM within their existing scoped subset).

**Permission change required:** `resources: ["edit"]` needs to be added to the `employee` role in the permission matrix (server `permissions.ts`, mirrored client-side) so employees can self-plan — today they only have `"view"`.

### Frontend changes
- `DayDetailPanel`'s read-only "planned today" label becomes an editable input per task (0.25h steps), defaulting to the current computed/stored value.
- A live running-total row compares the sum of inputs against the day's capacity, colored green/amber/red — computed instantly client-side, no network round trip needed just to preview the total.
- Tasks allocated outside their own date window show a small non-blocking warning badge.
- Saving calls the new upsert endpoint, replaces the panel's local state with the response, and triggers the grid to refetch so the day cell and load bar reflect the new numbers immediately.
- No changes needed to the grid's row-rendering logic — it already just displays whatever `plannedMinutes` the API returns.

### End-to-end example (the scenario you described)
1. Employee opens Resources, today's cell currently shows the old evenly-split total for Task A (15h) and Task B (10h).
2. Clicks today → panel opens with both tasks listed, pre-filled with today's auto-split numbers.
3. Types **6h** against Task A, **2h** against Task B. Running total shows **8h / 8.5h** — green.
4. Saves. Grid's day cell now shows 8h planned (not the old average), and this persists on reload — tomorrow, since no explicit split exists yet, still shows the auto-split fallback until planned.

### What does *not* change
- `ProjectTask.startDate`/`dueDate` are never modified by allocation — this is a planning layer only, not a scheduling layer. A task's official window stays exactly what it was.
- Actual time tracking (`TaskTimeEntry`, the stopwatch/work-log feature) is completely separate and untouched.
- Existing tasks/days with no explicit allocation behave identically to today — nothing breaks, nothing needs migrating.

### Finishing a task early (before its planned/estimated hours are used up)

A task can be marked `done` while it still had unused planned minutes for the day (e.g. 6h was allocated today, but the employee finishes in 3h) or unused estimated hours going forward. Two things need to happen:

**1. Today's leftover minutes — prompt to reallocate.**
When a task's status flips to `done` (whether via the task detail page or directly from the day panel) and the day still has unconsumed `plannedMinutes` on that task (`plannedMinutes` for that row > tracked time actually logged against it today), the day panel surfaces the freed-up amount instead of silently absorbing it into the total. The employee is prompted right there — "Task A finished with 3h unused today, apply it to another task?" — and can redistribute it into their other tasks' inputs for that same day using the same editor, before saving. If they decline/ignore it, the row is simply zeroed out (freed minutes just reduce the day's total rather than vanish into an untracked task).

**2. Future days — auto-split contribution is cleared.**
Completing a task early must not leave "ghost" planned hours sitting on days that haven't happened yet. Once a task's status is `done`, it's excluded from the uniform-split fallback calculation (`taskDateSpan`) for any date at or after completion — so days that hadn't been explicitly allocated yet simply stop counting that task's share, freeing that capacity for whatever else is assigned. Any date that *did* already have an explicit `TaskDailyAllocation` row for that task is left untouched (it's a historical record of what was actually planned/worked that day, not a projection).

**Backend implication:** the planner grid (`GET /resources/planner`) and day-detail (`GET /resources/planner/:employeeId/day`) queries need their task-eligibility filter to additionally check `status !== "done"` (or `completedAt === null`) before including a task in the fallback `taskDateSpan` computation for dates ≥ today — mirroring how `relevantTasks`/`taskDays` are already built, just with the completed-task exclusion applied only to the *forward-looking, non-explicit* portion of the calculation.

### Fast-follows (explicitly out of scope for this version)
- Per-employee capacity override (replacing the tenant-wide `WorkingSchedule` for individuals with different contracted hours).
- Recurring/template allocations ("repeat this split every working day until the due date").
- A drag-to-allocate visual timeline directly in the grid (v1 is edit-in-day-panel only).
- A dedicated week-at-a-glance bulk editor (the range-list endpoint exists for hydration now, but a full multi-day editing UI is later work).

---

## Files involved
- `server/prisma/schema.prisma` — new model + migration
- `server/src/routes/resources.ts` — new/modified endpoints
- `server/src/lib/permissions.ts` — add `resources: edit` for `employee`
- `SCT-PMS/src/features/resources/ResourcesPage.tsx` — editable day panel
- `SCT-PMS/src/types/tenant.ts` — new/extended types
- `SCT-PMS/src/lib/api.ts` — new client methods
- `SCT-PMS/src/lib/permissions.ts` — mirror permission change

# SCT-PMS Backend — Developer Guide

Express 5 + TypeScript + Prisma (PostgreSQL) API for a multi-tenant SaaS Project Management System.
Two separate identity planes: **PlatformUser** (SaaS-level super admins who manage tenants) and **CompanyUser** (tenant-scoped employees with one or more `SystemRole`s).

This file documents the codebase *as it currently exists*. Use it as ground truth when vibe-coding new features — don't reinvent patterns that already exist here.

---

## 1. Stack

- **Runtime**: Node + TypeScript, run via `tsx watch` in dev.
- **Framework**: Express 5.
- **DB/ORM**: PostgreSQL via Prisma Client 5.
- **Auth**: JWT (`jsonwebtoken`) in an httpOnly cookie named `token`, `bcryptjs` for password hashing.
- **Validation**: `zod`.
- **No test framework configured yet** (`npm test` is a placeholder).

### Scripts (`server/package.json`)
| Script | Command | Purpose |
|---|---|---|
| `dev` | `tsx watch src/index.ts` | Local dev server with hot reload |
| `build` | `tsc` | Compile to `dist/` |
| `start` | `node dist/index.js` | Run compiled server |
| `seed` | `tsx prisma/seed.ts` | Seed the database |

### Environment variables (`server/.env`)
| Var | Used in | Notes |
|---|---|---|
| `DATABASE_URL` | Prisma datasource | Postgres connection string |
| `JWT_SECRET` | `src/lib/jwt.ts` | Signs/verifies session JWTs. **Has an insecure hardcoded dev fallback — must be set explicitly in any real deployment.** |
| `PORT` | `src/index.ts` | Server listen port (defaults to `4000` if unset) |
| `CLIENT_ORIGIN` | `src/index.ts` | Comma-separated list of allowed CORS origins (defaults to `http://localhost:5173`) |
| `NODE_ENV` | `src/routes/auth.ts` | Toggles `secure` flag on the session cookie |

> **Known mismatch to check locally**: the backend defaults to port `4000`, but the frontend's API client (`SCT-PMS/src/lib/api.ts`) defaults to `http://localhost:4100/api` when `VITE_API_URL` isn't set. Confirm your actual `PORT` value and set `VITE_API_URL` accordingly, or align the two defaults.

There is no `.env.example` committed — create one with the four keys above (placeholder values) if onboarding new developers.

---

## 2. App bootstrap (`src/index.ts`)

- Loads `dotenv/config`, builds an Express app.
- Global middleware: `cors()` (dynamic origin check against `CLIENT_ORIGIN`, `credentials: true`), `express.json()`, `cookie-parser()`.
- `GET /api/health` → `{ ok: true }`.
- Mounted routers (all under `/api`):

| Path | Router file | Guard |
|---|---|---|
| `/api/auth` | `routes/auth.ts` | public |
| `/api/companies` | `routes/companies.ts` | platform only |
| `/api/audit` | `routes/audit.ts` | platform only |
| `/api/onboarding` | `routes/onboarding.ts` | company super admin only |
| `/api/company-users` | `routes/companyUsers.ts` | company, per-permission |
| `/api/company-users/invitations` | `routes/invitations.ts` | **public** (token-based) |
| `/api/settings` | `routes/settings.ts` | company, per-permission |
| `/api/departments` | `routes/departments.ts` | company, per-permission |
| `/api/teams` | `routes/teams.ts` | company, per-permission |
| `/api/projects` | `routes/projects.ts` | company, per-permission + row-level |

---

## 3. Auth & Authorization model

This is the most important section for any new feature — **always thread new endpoints through the existing permission system rather than inventing ad hoc checks.**

### Identity kinds
A JWT payload (`src/lib/jwt.ts`) is one of:
```ts
{ kind: "platform"; userId: string }
{ kind: "company"; userId: string; tenantId: string }
```
Tokens are signed for 8h and stored in an httpOnly, sameSite=lax cookie (`secure` in production).

### Roles (`SystemRole` enum — Prisma + duplicated as a TS type client-side)
`company_super_admin`, `hr_admin`, `department_head`, `team_lead`, `project_manager`, `employee`, `auditor`.

A `CompanyUser.roles` is an **array** — a user can hold multiple roles simultaneously. Always check permissions via the helper, never `roles.includes(x)` directly in new code (except the one legitimate exception: `requireCompanySuperAdmin`, which specifically gates onboarding to the super admin role).

### Middleware (`src/middleware/auth.ts`)
| Middleware | Behavior |
|---|---|
| `requireAuth` | Verifies the `token` cookie, populates `req.auth`. 401 if missing/invalid. |
| `requirePlatform` | 403 unless `req.auth.kind === "platform"`. |
| `requireCompany` | 403 unless `req.auth.kind === "company"`. |
| `requireCompanySuperAdmin` | Loads the CompanyUser fresh, checks `roles.includes("company_super_admin")`. |
| `requirePermission(module, action)` | **Primary authorization mechanism.** Loads the CompanyUser fresh from DB every request (no JWT role caching — role changes apply immediately) and checks `hasPermission(user.roles, module, action)`. |

### Permission matrix (`src/lib/permissions.ts` — source of truth; duplicated read-only in `SCT-PMS/src/lib/permissions.ts` for UI hiding)

Modules: `company_settings`, `company_users`, `projects`, `tasks`, `resources`.
Actions: `view`, `create`, `edit`, `deactivate`, `approve`, `export`, `invite`, `manage` (`manage` implies all other actions for that module).

| Role | company_settings | company_users | projects | tasks | resources |
|---|---|---|---|---|---|
| `company_super_admin` | manage | manage | manage | manage | manage |
| `hr_admin` | view, edit | view, create, edit, deactivate, invite | view | view | view, export |
| `department_head` | view | view | view, create, edit, approve | view, create, edit, approve | view |
| `team_lead` | view | view | view, edit | view, create, edit | view |
| `project_manager` | — | view | view, create, edit, deactivate, approve, export, manage | view, create, edit, approve, export, manage | view, export |
| `employee` | — | — | view | view, create, edit | view |
| `auditor` | view | view | view, export | view, export | view, export |

> A stale comment in `permissions.ts` claims only `company_settings`/`company_users` are server-enforced. **That's out of date** — `routes/projects.ts` enforces `projects`/`tasks` permissions extensively. Trust the code, not that comment.

### Row-level access (projects/tasks only — `routes/projects.ts`)
The permission matrix answers "can this role do X to projects in general?" On top of that, `routes/projects.ts` layers **per-record** scoping since not every `project_manager`/`employee` should see every project:

- `projectReadScope` — who can list/see which projects:
  - `company_super_admin`, `hr_admin`, `auditor` → all projects in tenant.
  - `department_head` → their department's projects, plus anything they own/manage/are a member or follower of, plus projects containing tasks assigned to them.
  - `team_lead` → the same, plus projects containing tasks assigned to any member of a team they lead.
  - everyone else → only projects they own, manage, are a member/follower of, or have an assigned task in.
- `projectAccessLevel(user, project)` → returns `"view" | "edit" | "manage" | null` per project, combining role + ownership + `ProjectMember.access` + department headship + task involvement. Returned to the frontend as `currentUserAccess` so the UI can do its own defense-in-depth check.
- `canEditTaskForProject` → project edit access, OR self-assignment on the task, OR team-lead over the assignee's team.

**When adding a new project/task endpoint**: always call the matching `requirePermission("projects"|"tasks", action)` AND re-derive/reuse the row-level access check — module-level permission alone is not sufficient for this resource.

### Multi-tenancy
Nearly every business model carries a `tenantId` (references `Company.id`). There is **no Postgres RLS** — every query in every route must manually filter by `req.auth.tenantId`. When writing a new query, grep for how sibling routes scope by `tenantId` and follow the same pattern; a missing tenant filter is a cross-tenant data leak.

---

## 4. Data model (`prisma/schema.prisma`)

### Tenancy & platform
- **PlatformUser** — SaaS-level admin (`role` is a plain string, default `"saas_super_admin"`), not tenant-scoped.
- **Company** (= "tenant") — root of everything: status/plan lifecycle (`CompanyStatus`, `SubscriptionPlan`), seat limits, enabled modules, branding/locale fields. Has-many almost every other model.
- **CompanyUser** — tenant-scoped login identity/employee (`roles: SystemRole[]`, `accountStatus: CompanyUserAccountStatus`). Unique on `[tenantId, email]`.
- **Invitation** — token-based invite flow, `status: InvitationStatus`, 7-day expiry convention used across routes.
- **AuditLog** — append-only audit trail (`actorId`, `actorKind`, `action`, optional `targetType/targetId`, `metadata Json`). Written via `recordAudit()` (`src/lib/audit.ts`) — call this from every mutating endpoint you add.

### Org structure
- **Department** — self-referential hierarchy (`parentId`), cycle-detection enforced in `routes/departments.ts` before saving.
- **Designation**, **Holiday**, **LeaveType**, **WorkingSchedule** — simple tenant-scoped reference data, mostly managed via the onboarding flow.
- **OnboardingState** — 1:1 with Company; JSON `steps` blob tracking the setup wizard's completion state.
- **Team** / **TeamMember** — a lead (`CompanyUser`) plus members; distinct from "roles" — team membership doesn't grant permissions by itself, only `team_lead`-over-project scoping cares about it.

### Projects & tasks (the core PM domain)
- **Project** — status/priority/methodology/type/visibility enums, budget & health tracking (`healthScore`/`healthStatus` recomputed after task mutations), manager/owner/department refs, unique `[tenantId, key]`.
- **ProjectMember** — join table with per-user `access: ProjectMemberAccess` (`view`/`edit`/`manage`) and `isFollower`/`allocationPercent`.
- **ProjectSection** — kanban-style columns (`status: TaskStatus` = `new_request`/`in_progress`/`done`); every new project auto-creates these 3 default sections.
- **ProjectTask** — supports subtasks (self-relation `parentTaskId`), per-project sequential `code`, dependencies (self-relation, circular-dependency checked at write time), checklist items, comments, attachments, followers — all cascade-delete with the task.
- **TaskTimeEntry** — start/stop timer; `endedAt: null` means "currently running." App code enforces one active timer per user (not a DB constraint) — respect this invariant in any new timer code.
- **ProjectMilestone** — has-many tasks, its own owner/dates/progress.

When adding a new field to Project/Task, remember to also touch `refreshProjectMetrics` if it affects completion/health, and the corresponding frontend type in `SCT-PMS/src/types/tenant.ts`.

---

## 5. Route-by-route summary

| Router | Notable endpoints | Auth |
|---|---|---|
| `auth.ts` | `POST /login/platform`, `POST /login/company`, `POST /logout`, `GET /me` | public |
| `companies.ts` | CRUD companies, `POST /:id/status` (lifecycle state machine), `POST /:id/users/:userId/generate-password` | platform only |
| `companyUsers.ts` | list/create employees (seat-limit enforced), `POST /:id/invite`, `PATCH /:id/roles` (blocks removing the last super admin) | company, per-permission |
| `invitations.ts` | `GET /:token`, `POST /:token/accept` (zod password rules: 8+ chars, upper/lower/digit) | public, token-based |
| `audit.ts` | `GET /` (filter by tenantId/action, latest 200 rows) | platform only |
| `onboarding.ts` | step-by-step company setup wizard (profile/schedule/departments/designations/holidays/leave types) | company super admin only |
| `settings.ts` | `GET/PATCH /` company profile | company, per-permission |
| `departments.ts` | CRUD + cycle detection + activate/deactivate | company, per-permission |
| `teams.ts` | CRUD + member management | company, per-permission |
| `projects.ts` | Full PM surface: projects, sections, tasks, subtasks, comments, checklists, attachments, dependencies, time tracking, milestones, members | company, per-permission + row-level |

---

## 6. Conventions to follow when adding features

1. **Auth stack every new route**: `requireAuth` → `requireCompany`/`requirePlatform` → `requirePermission(module, action)` → (for projects/tasks) row-level access check.
2. **Always filter by `tenantId`** pulled from `req.auth` — never trust a tenantId from the request body/params for a company-scoped resource.
3. **Validate input with `zod`** before touching Prisma, matching the style already in `routes/companies.ts`/`routes/invitations.ts`.
4. **Audit every mutation** via `recordAudit()` — look at how existing routes call it to match the `action` naming convention (e.g. `"company.created"`, `"companyUser.roleUpdated"`).
5. **Use `$transaction`** for multi-step writes that must be atomic (see `companyUsers.ts` create-with-invite flow).
6. **Keep the client-side permission matrix in sync** — if you change `server/src/lib/permissions.ts`, mirror it in `SCT-PMS/src/lib/permissions.ts` (server remains the enforced source of truth; the frontend copy only drives UI hiding).
7. **New Prisma models/fields**: run a migration (`npx prisma migrate dev`), then update the corresponding type in `SCT-PMS/src/types/tenant.ts` and any `api.ts` client function.

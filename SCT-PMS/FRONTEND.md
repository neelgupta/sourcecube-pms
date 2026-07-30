# SCT-PMS Frontend — Developer Guide

React 19 + TypeScript + Vite SPA for the multi-tenant SaaS Project Management System. This documents the codebase *as it currently exists* — use it as ground truth so vibe-coded features fit existing conventions instead of introducing new ones.

---

## 1. Stack

- **Framework**: React 19 + `react-router-dom` 7 (`createBrowserRouter`).
- **Styling**: Tailwind CSS 4 (via `@tailwindcss/vite`).
- **Charts**: `recharts`.
- **Icons**: `lucide-react`.
- **Utilities**: `clsx` for conditional classNames.
- **State management**: none — local `useState` + React Context (`SessionProvider`). No Redux/Zustand/Jotai.
- **Data fetching**: none — a hand-written typed `fetch` wrapper (`src/lib/api.ts`) called from `useEffect`. No react-query/SWR.
- **Forms**: plain controlled inputs. No react-hook-form/formik.
- **Linting**: `oxlint`.

### Scripts (`package.json`)
| Script | Command |
|---|---|
| `dev` | `vite` |
| `build` | `tsc -b && vite build` |
| `lint` | `oxlint` |
| `preview` | `vite preview` |

### Environment
`VITE_API_URL` — backend API base, defaults to `http://localhost:4100/api` in `src/lib/api.ts` if unset.

> **Check this against the backend's actual `PORT`** (backend defaults to `4000`). Set `VITE_API_URL=http://localhost:<backend-port>/api` in a `.env` file, or align the defaults, before running both sides together.

---

## 2. Directory structure

```
src/
  main.tsx, App.tsx, index.css
  app/
    router.tsx            — central route table (createBrowserRouter)
    ProtectedRoute.tsx      — auth/permission route guard
    RootRedirect.tsx        — "/" redirect logic based on session kind
    PlaceholderPage.tsx      — stub for not-yet-built routes
  lib/
    api.ts                  — typed fetch client, every backend call goes through here
    session.tsx              — SessionProvider / useSession / usePermission / useCurrentTenantId
    permissions.ts            — client-side copy of the role→permission matrix (UI hiding only)
    cn.ts                     — classnames helper
  types/
    index.ts                  — legacy/mock domain types (User/Project/Task with loose `role: string`) — used only by still-mocked screens
    tenant.ts                  — real API-backed domain types (Company, CompanyUser, RealProject, WorkspaceTask, etc.) — used by real screens
  components/
    common/                    — Button, Avatar, Input, Table, Modal, Tabs, ProgressBar, EmptyState, SearchBar, Card, Logo, Dropdown, Badge (barrel-exported)
    layout/                    — Sidebar.tsx, Topbar.tsx, AppLayout.tsx
  features/
    dashboard/    auth/    projects/    tasks/    saas/    onboarding/
    settings/     departments/    teams/    team/    resources/
  mock/
    tasks.ts, dashboard.ts, projects.ts, resources.ts, users.ts  — static mock data, still backing dashboard/resources views
```

**⚠️ Naming trap**: `features/team/` (singular — roles & employees admin, `TeamRolesPage`) and `features/teams/` (plural — the actual `Team` entity/membership) are two different features. Don't confuse them when navigating or adding code.

**⚠️ Two parallel type systems**: `types/index.ts` + `src/mock/*` back the still-mocked dashboard/resources screens; `types/tenant.ts` + `lib/api.ts` back everything wired to the real backend (projects, team/roles, settings, onboarding). Know which screen you're touching before picking a type import.

---

## 3. Routing & route guards (`src/app/router.tsx`, `src/app/ProtectedRoute.tsx`)

Public routes: `/login` (handles both normal login and invite-accept), `/forgot-password`, `/access-denied`, `/account-suspended`, `/` and `*` (`RootRedirect`: platform users → `/saas`, company users → `/dashboard`, unauthenticated → `/login`).

`ProtectedRoute` enforces, in order:
1. Wait for session load.
2. No session → `/login`.
3. Company user `accountStatus !== "active"` → `/account-suspended`.
4. `requireKind` mismatch (`"platform"` vs `"company"`) → `/access-denied`.
5. `requiredPermission={module, action}` fails client-side `hasPermission` check → `/access-denied`.

### Route → guard table
| Route | Kind | Required permission |
|---|---|---|
| `/dashboard` | company | — |
| `/projects`, `/projects/:projectId`, `/milestones` | company | `projects:view` |
| `/tasks`, `/check-ins`, `/calendar`, `/timesheet` | company | `tasks:view` |
| `/workflow` | company | `projects:edit` |
| `/budgets` | company | `projects:manage` |
| `/resources` | company | `resources:view` |
| `/reports` | company | `resources:export` |
| `/onboarding` | company | `company_settings:manage` |
| `/team` (TeamRolesPage) | company | `company_users:view` |
| `/settings`, `/departments`, `/teams` | company | `company_settings:view` |
| `/saas`, `/saas/audit` | platform | — |

`/milestones`, `/check-ins`, `/calendar`, `/timesheet`, `/workflow`, `/budgets`, `/reports` currently render `PlaceholderPage` — **routes/guards exist, UI does not yet**. Guard behavior is real even though the page is a stub — client-side permission checks are enforced from day one, not bolted on later.

---

## 4. Auth, session & permissions

### `src/lib/session.tsx`
- `SessionProvider` calls `api.me()` on mount; exposes `session.user` discriminated by `kind: "platform" | "company"`, plus `session.company` for company users.
- `useSession()` — context accessor.
- `usePermission(module, action)` — hook; always `false` for platform users or no session; else delegates to `hasPermission`. **Use this for every conditional render/action gate in a feature page** — don't hand-roll role checks.
- `useCurrentTenantId()` — returns the current tenant id for company users.
- `scopeToCurrentTenant(records, tenantId)` — client-side tenant filter helper, mainly used with still-mocked data.

### `src/lib/permissions.ts`
Exact duplicate of the backend's `Module`/`Action`/`SystemRole` types and matrix — **UI convenience only, not a security boundary**. The server enforces the real rule via `requirePermission` + row-level checks; this copy exists purely to hide buttons/nav items a user can't act on. If you change the matrix, edit `server/src/lib/permissions.ts` first and mirror it here — never the other way around.

### Permission matrix (mirror of backend — see `server/BACKEND.md` for the authoritative table)
Modules: `company_settings`, `company_users`, `projects`, `tasks`, `resources`. Roles: `company_super_admin`, `hr_admin`, `department_head`, `team_lead`, `project_manager`, `employee`, `auditor`.

### Sidebar (`src/components/layout/Sidebar.tsx`)
Each `NavItem` can declare `requires: {module, action}`; the list is filtered through `hasPermission(session.user.roles, ...)` before rendering — so nav links disappear for roles that can't use them, independent of (but consistent with) route guards. Platform users get an entirely separate `platformNavItems` list (Companies, Audit log).

### Row-level access (projects specifically)
For projects/tasks, the backend also returns a per-record `currentUserAccess` (`"view" | "edit" | "manage" | null`, see `server/BACKEND.md` §3). Existing feature code (`ProjectsPage.tsx`) combines the module-level `usePermission` flag **and** `currentUserAccess` before allowing an action — e.g. `canEdit && (p.currentUserAccess === "edit" || p.currentUserAccess === "manage")`. **Follow this same double-check pattern for any new project/task UI action** — a module permission alone isn't enough to show an edit control on a specific project.

---

## 5. Feature-folder conventions

Convention for a new feature `foo`:
```
features/foo/FooPage.tsx        — route-level component, does the data loading
features/foo/components/*        — drawers, cards, editors specific to this feature
```

Established pattern (seen in `TeamRolesPage.tsx`, `ProjectsPage.tsx`):
1. `FooPage.tsx` loads data via a `load()` function called from `useEffect`, using functions from `src/lib/api.ts` (never raw `fetch` in feature files).
2. Per-action permission checks via `usePermission(module, action)` (e.g. `canEdit`, `canCreate`, `canInvite`, `canViewTeams`) gate button/column visibility.
3. For project/task screens, also combine with backend-provided `currentUserAccess` — see above.
4. Row actions delegate to small, focused child components (e.g. `RoleEditor` — self-contained modal, owns its own local state and its own `api.*` call).
5. Drawers/modals take `open`, `onClose`, `onSaved` props.
6. Shared primitives come from `@/components/common` (barrel export): `Button`, `Badge`, `Card`, `Modal`, `SearchBar`, `Dropdown`, `Avatar`, `Table`, etc. — don't build one-off buttons/cards inside a feature folder if an equivalent primitive already exists.
7. Error handling: `catch (err) { setError(err instanceof ApiError ? err.message : "fallback message") }`.

---

## 6. Conventions to follow when adding features

1. **Always gate new UI with `usePermission`**, matching the same `module`/`action` pair the corresponding backend route enforces — check `server/BACKEND.md` §5 for what the backend expects before wiring a new screen.
2. **For projects/tasks specifically**, also honor `currentUserAccess` returned by the API — don't rely on module permission alone.
3. **Add new routes to `src/app/router.tsx`** with the correct `requireKind`/`requiredPermission`, even if the page is a `PlaceholderPage` stub for now — this keeps the guard behavior correct from the start.
4. **Add nav entries to `Sidebar.tsx`** with a matching `requires` so the link only shows for roles that can use it.
5. **New API calls go in `src/lib/api.ts`** as typed functions — never call `fetch` directly from a feature component.
6. **New response shapes go in `src/types/tenant.ts`** (for real, backend-driven features) — don't extend the legacy `types/index.ts` mock types for new work.
7. **If the backend permission matrix changes**, mirror the update in `src/lib/permissions.ts` immediately so UI hiding stays consistent with server enforcement.

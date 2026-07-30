# Sourcecube PMS — Frontend

Enterprise Project Management System UI built with **React 19 + Vite + TypeScript + Tailwind CSS v4**.
Frontend only — every screen runs on typed mock data, with no backend, API or auth logic.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production bundle
```

## Architecture

Feature-based modules on top of a shared component layer, so a backend can be wired in later
without restructuring the UI.

```
src/
  app/              Router + placeholder route shells
  components/
    common/         Reusable primitives (Button, Card, Badge, Table, Modal, Drawer,
                    Tabs, Dropdown, Avatar, Input, ProgressBar, SearchBar, EmptyState)
    layout/         AppLayout, Sidebar, Topbar
  features/
    auth/           Login page
    dashboard/      Overview, Global Dashboard, My Dashboard + chart components
    projects/       Project grid/list, project detail, task list, task drawer, add-project drawer
    resources/      Resource planner grid
  mock/             Demo data (users, projects, tasks, dashboard metrics, resources)
  types/            Shared domain types
  lib/              Utilities
  index.css         Design tokens (@theme) + base layer
```

### Conventions

- **Design tokens** live in `src/index.css` under `@theme`. The palette follows the Sourcecube
  Technologies brand: `brand-*` is the logo green (primary actions, active nav, progress, charts),
  `navy-*` is the wordmark navy (headings, dark surfaces), plus neutral `ink-*`/`surface-*` and
  reserved status colors. Components reference tokens, never raw hex.
- **Branding** — `<Logo />` and `<LogoMark />` in `components/common/Logo.tsx` render the
  Sourcecube lockup as scalable SVG; used in the sidebar, login page and favicon.
- **Path alias** `@/*` maps to `src/*`.
- **Typing** — all domain shapes live in `src/types`; components accept typed props, no `any`.
- **Data boundary** — every feature imports from `src/mock/*`. Swapping those modules for API
  calls (or a query layer) is the only change needed to connect a backend.

## Implemented modules

| Module | Route | Notes |
|---|---|---|
| Login | `/login` | Split hero layout, validation-ready form, social sign-in |
| Dashboard | `/dashboard` | Overview (stats, leaderboard, activity chart, due tasks), Global Dashboard (widget grid + analytics), My Dashboard |
| Projects | `/projects` | Grid/list toggle, favourites, search + status filter, add-project drawer |
| Project detail | `/projects/:projectId` | View tabs, sectioned task list, task detail drawer with activities/work log |
| Resources | `/resources` | Day-by-day allocation grid, utilisation bars, occupancy filters, sticky columns |

Remaining sidebar destinations (Tasks, Check-ins, Calendar, Workflow, Budgets, Milestones,
Timesheet, Reports) render a scoped placeholder so navigation and layout stay complete.

## Charts

Recharts, single-series per chart with one hue each, direct value labels, and a shared tooltip
component (`features/dashboard/components/chartPrimitives.tsx`). The categorical palette used for
priority breakdowns is validated for color-vision-deficiency separation.

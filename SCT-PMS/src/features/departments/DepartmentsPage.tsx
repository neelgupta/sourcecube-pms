import { useEffect, useMemo, useState } from "react";
import { Building2, LayoutList, Network, Plus } from "lucide-react";
import { Badge, Button, Card, DataTable, SearchBar, type Column } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import { usePermission } from "@/lib/session";
import type { CompanyUser, Department } from "@/types/tenant";
import { DepartmentDrawer } from "./components/DepartmentDrawer";
import { DepartmentTree } from "./components/DepartmentTree";

export function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"tree" | "table">("tree");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const canManage = usePermission("company_settings", "manage");

  function load() {
    Promise.all([api.listDepartmentsFull(), api.listCompanyUsers()])
      .then(([deptRes, userRes]) => {
        setDepartments(deptRes.departments);
        setCompanyUsers(userRes.users);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load departments"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const filtered = useMemo(
    () => departments.filter((d) => !search || d.name.toLowerCase().includes(search.toLowerCase())),
    [departments, search],
  );

  async function toggleStatus(d: Department) {
    try {
      await api.setDepartmentStatus(d.id, !d.isActive);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update status");
    }
  }

  const columns: Column<Department>[] = [
    {
      key: "name",
      header: "Department",
      render: (d) => (
        <button onClick={() => { setEditing(d); setDrawerOpen(true); }} className="font-medium text-ink-900 hover:text-brand-600">
          {d.name}
        </button>
      ),
    },
    {
      key: "parent",
      header: "Parent",
      render: (d) => departments.find((p) => p.id === d.parentId)?.name ?? "—",
    },
    { key: "head", header: "Head", render: (d) => d.headUser?.name ?? "Unassigned" },
    { key: "costCenter", header: "Cost center", render: (d) => d.costCenter ?? "—" },
    { key: "budget", header: "Budget", render: (d) => (d.budget != null ? `${d.budget}` : "—") },
    { key: "status", header: "Status", render: (d) => <Badge tone={d.isActive ? "green" : "neutral"}>{d.isActive ? "Active" : "Inactive"}</Badge> },
    {
      key: "actions",
      header: "",
      width: "120px",
      render: (d) =>
        canManage ? (
          <Button variant="outline" size="sm" onClick={() => toggleStatus(d)}>
            {d.isActive ? "Deactivate" : "Activate"}
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-white px-4 py-3 lg:px-6">
        <p className="flex items-center gap-2 text-sm font-medium text-ink-700">
          <Building2 size={18} className="text-brand-600" />
          <span className="text-lg font-bold text-ink-900">{filtered.length}</span> Departments
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <SearchBar value={search} onChange={setSearch} placeholder="Search departments" className="w-56" />
          <div className="flex items-center rounded-lg border border-ink-200 bg-white p-0.5">
            <ViewToggle active={view === "tree"} onClick={() => setView("tree")}>
              <Network size={16} />
            </ViewToggle>
            <ViewToggle active={view === "table"} onClick={() => setView("table")}>
              <LayoutList size={16} />
            </ViewToggle>
          </div>
          {canManage && (
            <Button
              onClick={() => {
                setEditing(null);
                setDrawerOpen(true);
              }}
            >
              <Plus size={16} className="mr-1.5" />
              Create department
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 p-4 lg:p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
            {error}
          </div>
        )}
        <Card className={view === "tree" ? "p-3" : "overflow-hidden"}>
          {view === "tree" ? (
            <DepartmentTree
              departments={filtered}
              onSelect={(d) => {
                setEditing(d);
                setDrawerOpen(true);
              }}
            />
          ) : (
            <DataTable
              columns={columns}
              rows={filtered}
              rowKey={(d) => d.id}
              emptyMessage={loading ? "Loading…" : "No departments match your search"}
            />
          )}
        </Card>
      </div>

      <DepartmentDrawer
        open={drawerOpen}
        department={editing}
        departments={departments}
        companyUsers={companyUsers}
        onClose={() => setDrawerOpen(false)}
        onSaved={load}
      />
    </div>
  );
}

function ViewToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={active ? "rounded-md bg-brand-600 p-1.5 text-white" : "rounded-md p-1.5 text-ink-500 transition-colors hover:bg-ink-100"}
    >
      {children}
    </button>
  );
}

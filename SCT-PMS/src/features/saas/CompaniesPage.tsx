import { useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, Clock, Plus, ShieldAlert } from "lucide-react";
import {
  Card,
  CompanyStatusBadge,
  DataTable,
  FilterSelect,
  SearchBar,
  type Column,
} from "@/components/common";
import { Button } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import type { Company, CompanyStats } from "@/types/tenant";
import { CreateCompanyDrawer } from "./components/CreateCompanyDrawer";
import { CompanyDetailDrawer } from "./components/CompanyDetailDrawer";

const statusOptions = [
  { value: "all", label: "All statuses" },
  { value: "provisioning", label: "Provisioning" },
  { value: "invitation_pending", label: "Invitation pending" },
  { value: "trial", label: "Trial" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "deactivated", label: "Deactivated" },
];

type SortKey = "name" | "createdAt" | "status";

export function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stats, setStats] = useState<CompanyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortKey>("createdAt");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    api
      .listCompanies()
      .then((res) => {
        setCompanies(res.companies);
        setStats(res.stats);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load companies"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  const filtered = useMemo(() => {
    const rows = companies.filter((c) => {
      const matchesSearch =
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.code.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = status === "all" || c.status === status;
      return matchesSearch && matchesStatus;
    });
    return [...rows].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "status") return a.status.localeCompare(b.status);
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [companies, search, status, sort]);

  const columns: Column<Company>[] = [
    {
      key: "name",
      header: "Company",
      render: (c) => (
        <div>
          <p className="font-medium text-ink-900">{c.name}</p>
          <p className="text-xs text-ink-500">{c.code}</p>
        </div>
      ),
    },
    { key: "plan", header: "Plan", render: (c) => <span className="capitalize">{c.plan}</span> },
    {
      key: "seats",
      header: "Seats",
      render: (c) => (
        <span className="text-xs font-medium text-ink-600">
          {c._count?.companyUsers ?? 0} / {c.employeeSeatLimit}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (c) => <CompanyStatusBadge status={c.status} /> },
    {
      key: "createdAt",
      header: "Created",
      render: (c) => <span className="text-xs">{new Date(c.createdAt).toLocaleDateString()}</span>,
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-white px-4 py-3 lg:px-6">
        <p className="text-sm font-medium text-ink-700">
          <span className="text-lg font-bold text-ink-900">{filtered.length}</span> Companies
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <SearchBar value={search} onChange={setSearch} placeholder="Search companies" className="w-56" />
          <FilterSelect value={status} options={statusOptions} onChange={setStatus} className="w-48" />
          <FilterSelect
            value={sort}
            options={[
              { value: "createdAt", label: "Newest first" },
              { value: "name", label: "Name (A-Z)" },
              { value: "status", label: "Status" },
            ]}
            onChange={(v) => setSort(v as SortKey)}
            className="w-40"
          />
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} className="mr-1.5" />
            Create company
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-5 p-4 lg:p-6">
        {error && (
          <div className="rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard icon={Building2} label="Total companies" value={stats?.total} accent="blue" />
          <StatCard icon={CheckCircle2} label="Active" value={stats?.active} accent="green" />
          <StatCard icon={Clock} label="Trial" value={stats?.trial} accent="amber" />
          <StatCard icon={ShieldAlert} label="Suspended" value={stats?.suspended} accent="red" />
        </div>

        <Card className="overflow-hidden">
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(c) => c.id}
            onRowClick={(c) => setSelectedCompanyId(c.id)}
            emptyMessage={loading ? "Loading…" : "No companies match your filters"}
          />
        </Card>
      </div>

      <CreateCompanyDrawer open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />
      <CompanyDetailDrawer
        companyId={selectedCompanyId}
        onClose={() => setSelectedCompanyId(null)}
        onChanged={load}
      />
    </div>
  );
}

const accentStyles = {
  blue: "bg-info-50 text-info-600",
  green: "bg-success-50 text-success-600",
  amber: "bg-warning-50 text-warning-600",
  red: "bg-danger-50 text-danger-600",
};

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Building2;
  label: string;
  value: number | undefined;
  accent: keyof typeof accentStyles;
}) {
  return (
    <Card className="flex items-center gap-3.5 p-4">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${accentStyles[accent]}`}>
        <Icon size={20} />
      </div>
      <div>
        <p className="text-xl font-bold leading-tight text-ink-900">{value ?? "—"}</p>
        <p className="text-xs text-ink-500">{label}</p>
      </div>
    </Card>
  );
}

import { useEffect, useState } from "react";
import { Card, DataTable, SearchBar, type Column } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import type { AuditLogEntry } from "@/types/tenant";

export function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api
      .listAuditLogs()
      .then((res) => setLogs(res.logs))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load audit log"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = logs.filter(
    (l) =>
      !search ||
      l.action.toLowerCase().includes(search.toLowerCase()) ||
      l.company?.name.toLowerCase().includes(search.toLowerCase()),
  );

  const columns: Column<AuditLogEntry>[] = [
    {
      key: "createdAt",
      header: "Time",
      render: (l) => <span className="text-xs">{new Date(l.createdAt).toLocaleString()}</span>,
    },
    { key: "action", header: "Action", render: (l) => <span className="font-medium">{l.action}</span> },
    { key: "company", header: "Company", render: (l) => l.company?.name ?? "—" },
    { key: "actor", header: "Actor", render: (l) => <span className="text-xs">{l.actorKind}</span> },
    {
      key: "metadata",
      header: "Details",
      render: (l) => (
        <span className="block max-w-md truncate text-xs text-ink-500">
          {l.metadata ? JSON.stringify(l.metadata) : "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-white px-4 py-3 lg:px-6">
        <p className="text-sm font-medium text-ink-700">
          <span className="text-lg font-bold text-ink-900">{filtered.length}</span> Audit events
        </p>
        <SearchBar value={search} onChange={setSearch} placeholder="Search actions or companies" className="w-64" />
      </div>

      <div className="flex-1 p-4 lg:p-6">
        {error && (
          <div className="mb-4 rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
            {error}
          </div>
        )}
        <Card className="overflow-hidden">
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(l) => l.id}
            emptyMessage={loading ? "Loading…" : "No audit events yet"}
          />
        </Card>
      </div>
    </div>
  );
}

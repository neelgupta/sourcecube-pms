import { useEffect, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { Badge, Button, Checkbox, Field, Input } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import type { LeaveType } from "@/types/tenant";

export function LeaveTypesStep({ onSaved }: { onSaved: () => void }) {
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", annualQuota: "12", paid: true, carryForward: false });

  function load() {
    api
      .listLeaveTypes()
      .then((res) => setLeaveTypes(res.leaveTypes))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createLeaveType({ ...form, annualQuota: Number(form.annualQuota) });
      setForm({ name: "", annualQuota: "12", paid: true, carryForward: false });
      load();
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add leave type");
    }
  }

  async function handleRemove(id: string) {
    try {
      await api.deleteLeaveType(id);
      setLeaveTypes((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove leave type");
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-ink-900">Leave types &amp; policies</h2>
      <p className="text-sm text-ink-500">Set up the leave types employees can request.</p>

      {error && (
        <div className="rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
          {error}
        </div>
      )}

      <form onSubmit={handleAdd} className="space-y-3 rounded-lg border border-ink-200 p-4">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="Leave type name" className="mb-0">
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          </Field>
          <Field label="Annual quota" className="mb-0">
            <Input
              type="number"
              min={0}
              value={form.annualQuota}
              onChange={(e) => setForm((f) => ({ ...f, annualQuota: e.target.value }))}
              className="w-28"
              required
            />
          </Field>
        </div>
        <div className="flex items-center gap-5">
          <Checkbox label="Paid" checked={form.paid} onChange={(e) => setForm((f) => ({ ...f, paid: e.target.checked }))} />
          <Checkbox
            label="Allow carry-forward"
            checked={form.carryForward}
            onChange={(e) => setForm((f) => ({ ...f, carryForward: e.target.checked }))}
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={!form.name}>
            Add leave type
          </Button>
        </div>
      </form>

      <div className="divide-y divide-ink-100 rounded-lg border border-ink-200">
        {loading && <p className="px-3.5 py-3 text-sm text-ink-500">Loading…</p>}
        {!loading && leaveTypes.length === 0 && (
          <p className="px-3.5 py-3 text-sm text-ink-500">No leave types added yet.</p>
        )}
        {leaveTypes.map((l) => (
          <div key={l.id} className="flex items-center justify-between px-3.5 py-2.5 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium text-ink-900">{l.name}</span>
              <span className="text-xs text-ink-500">{l.annualQuota} days/yr</span>
              <Badge tone={l.paid ? "green" : "neutral"}>{l.paid ? "Paid" : "Unpaid"}</Badge>
              {l.carryForward && <Badge tone="blue">Carry-forward</Badge>}
            </div>
            <button
              onClick={() => handleRemove(l.id)}
              className="rounded p-1 text-ink-400 transition-colors hover:bg-danger-50 hover:text-danger-600"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

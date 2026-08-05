import { useEffect, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { Button, Checkbox, DatePicker, Field, Input, Select } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import { formatDateOnly } from "@/lib/formatDate";
import { useCompanyTimezone } from "@/lib/session";
import type { Holiday, HolidayType } from "@/types/tenant";

export function HolidaysStep({ onSaved }: { onSaved: () => void }) {
  const timezone = useCompanyTimezone();
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", date: "", type: "national" as HolidayType, optional: false });

  function load() {
    api
      .listHolidays()
      .then((res) => setHolidays(res.holidays))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createHoliday(form);
      setForm({ name: "", date: "", type: "national", optional: false });
      load();
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add holiday");
    }
  }

  async function handleRemove(id: string) {
    try {
      await api.deleteHoliday(id);
      setHolidays((prev) => prev.filter((h) => h.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove holiday");
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-ink-900">Default holidays</h2>
      <p className="text-sm text-ink-500">Add the holidays your company observes this year.</p>

      {error && (
        <div className="rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
          {error}
        </div>
      )}

      <form onSubmit={handleAdd} className="grid grid-cols-[1fr_auto_auto_auto] items-end gap-3">
        <Field label="Holiday name" className="mb-0">
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
        </Field>
        <Field label="Date" className="mb-0">
          <DatePicker value={form.date} onChange={(value) => setForm((f) => ({ ...f, date: value ?? "" }))} allowClear={false} />
        </Field>
        <Field label="Type" className="mb-0">
          <Select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as HolidayType }))}>
            <option value="national">National</option>
            <option value="regional">Regional</option>
            <option value="company">Company</option>
          </Select>
        </Field>
        <Button type="submit" disabled={!form.name || !form.date}>
          Add
        </Button>
      </form>

      <Checkbox
        label="Optional holiday"
        checked={form.optional}
        onChange={(e) => setForm((f) => ({ ...f, optional: e.target.checked }))}
      />

      <div className="divide-y divide-ink-100 rounded-lg border border-ink-200">
        {loading && <p className="px-3.5 py-3 text-sm text-ink-500">Loading…</p>}
        {!loading && holidays.length === 0 && <p className="px-3.5 py-3 text-sm text-ink-500">No holidays added yet.</p>}
        {holidays.map((h) => (
          <div key={h.id} className="flex items-center justify-between px-3.5 py-2.5 text-sm">
            <div>
              <span className="font-medium text-ink-900">{h.name}</span>
              <span className="ml-2 text-xs text-ink-500">
                {formatDateOnly(h.date, timezone)} · {h.type}
                {h.optional && " · optional"}
              </span>
            </div>
            <button
              onClick={() => handleRemove(h.id)}
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

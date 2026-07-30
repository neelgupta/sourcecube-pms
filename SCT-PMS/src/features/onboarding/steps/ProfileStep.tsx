import { useState, type FormEvent } from "react";
import { Button, Field, Input } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import type { Company } from "@/types/tenant";

interface Props {
  company: Company;
  onSaved: (company: Company) => void;
}

export function ProfileStep({ company, onSaved }: Props) {
  const [form, setForm] = useState({
    name: company.name,
    domain: company.domain ?? "",
    country: company.country,
    timezone: company.timezone,
    currency: company.currency,
    fiscalYearStart: company.fiscalYearStart,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await api.updateCompanyProfile(form);
      onSaved(res.company);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save company profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <h2 className="text-lg font-semibold text-ink-900">Company branding &amp; regional settings</h2>
      <p className="text-sm text-ink-500">
        These details appear across the platform and drive date, currency and fiscal-year formatting.
      </p>

      {error && (
        <div className="rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
          {error}
        </div>
      )}

      <Field label="Company name" required>
        <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
      </Field>
      <Field label="Domain">
        <Input value={form.domain} onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))} />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Country" required>
          <Input value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} required />
        </Field>
        <Field label="Timezone" required>
          <Input
            value={form.timezone}
            onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
            required
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Currency" required>
          <Input
            value={form.currency}
            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
            required
          />
        </Field>
        <Field label="Fiscal year start" hint="MM-DD" required>
          <Input
            value={form.fiscalYearStart}
            onChange={(e) => setForm((f) => ({ ...f, fiscalYearStart: e.target.value }))}
            required
          />
        </Field>
      </div>

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save & continue"}
        </Button>
      </div>
    </form>
  );
}

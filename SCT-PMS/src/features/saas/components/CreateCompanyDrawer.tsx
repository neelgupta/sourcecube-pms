import { useState, type FormEvent } from "react";
import { Building2 } from "lucide-react";
import { Button, Drawer, Field, Input, Select } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import type { SubscriptionPlan } from "@/types/tenant";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const emptyForm = {
  name: "",
  code: "",
  domain: "",
  country: "",
  timezone: "",
  currency: "",
  fiscalYearStart: "04-01",
  plan: "starter" as SubscriptionPlan,
  employeeSeatLimit: "10",
  adminName: "",
  adminEmail: "",
};

export function CreateCompanyDrawer({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.createCompany({
        name: form.name,
        code: form.code.toUpperCase(),
        domain: form.domain || undefined,
        country: form.country,
        timezone: form.timezone,
        currency: form.currency,
        fiscalYearStart: form.fiscalYearStart,
        plan: form.plan,
        employeeSeatLimit: Number(form.employeeSeatLimit),
        adminName: form.adminName,
        adminEmail: form.adminEmail,
      });
      setForm(emptyForm);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create company");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Building2 size={18} className="text-brand-600" />
          Create company
        </span>
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Creating…" : "Create company"}
          </Button>
        </>
      }
    >
      <form id="create-company-form" onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
            {error}
          </div>
        )}

        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-400">Company details</h3>
        <Field label="Company name" required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Company code" hint="Short, unique, uppercase" required>
            <Input
              value={form.code}
              onChange={(e) => set("code", e.target.value.toUpperCase())}
              placeholder="e.g. ACME"
              required
            />
          </Field>
          <Field label="Domain">
            <Input value={form.domain} onChange={(e) => set("domain", e.target.value)} placeholder="acme.com" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Country" required>
            <Input value={form.country} onChange={(e) => set("country", e.target.value)} required />
          </Field>
          <Field label="Timezone" required>
            <Input
              value={form.timezone}
              onChange={(e) => set("timezone", e.target.value)}
              placeholder="Asia/Kolkata"
              required
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Currency" required>
            <Input
              value={form.currency}
              onChange={(e) => set("currency", e.target.value.toUpperCase())}
              placeholder="INR"
              required
            />
          </Field>
          <Field label="Fiscal year start" hint="MM-DD" required>
            <Input
              value={form.fiscalYearStart}
              onChange={(e) => set("fiscalYearStart", e.target.value)}
              placeholder="04-01"
              required
            />
          </Field>
        </div>

        <h3 className="pt-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Plan &amp; limits</h3>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Subscription plan" required>
            <Select value={form.plan} onChange={(e) => set("plan", e.target.value as SubscriptionPlan)}>
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="enterprise">Enterprise</option>
            </Select>
          </Field>
          <Field label="Employee seat limit" required>
            <Input
              type="number"
              min={1}
              value={form.employeeSeatLimit}
              onChange={(e) => set("employeeSeatLimit", e.target.value)}
              required
            />
          </Field>
        </div>

        <h3 className="pt-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
          First Company Super Admin
        </h3>
        <Field label="Full name" required>
          <Input value={form.adminName} onChange={(e) => set("adminName", e.target.value)} required />
        </Field>
        <Field label="Work email" hint="An invitation will be created for this address" required>
          <Input
            type="email"
            value={form.adminEmail}
            onChange={(e) => set("adminEmail", e.target.value)}
            required
          />
        </Field>
      </form>
    </Drawer>
  );
}

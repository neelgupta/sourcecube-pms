import { useEffect, useState } from "react";
import { Button, Checkbox, Field, Input } from "@/components/common";
import { api, ApiError } from "@/lib/api";

const DAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

export function ScheduleStep({ onSaved }: { onSaved: () => void }) {
  const [workingDays, setWorkingDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [breakMinutes, setBreakMinutes] = useState("60");
  const [breakStartTime, setBreakStartTime] = useState("14:00");
  const [breakEndTime, setBreakEndTime] = useState("14:30");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listSchedules().then((res) => {
      const existing = res.schedules[0];
      if (existing) {
        setWorkingDays(existing.workingDays);
        setStartTime(existing.startTime);
        setEndTime(existing.endTime);
        setBreakMinutes(String(existing.breakMinutes));
        setBreakStartTime(existing.breakStartTime);
        setBreakEndTime(existing.breakEndTime);
      }
    });
  }, []);

  function toggleDay(day: number) {
    setWorkingDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await api.saveSchedule({ workingDays, startTime, endTime, breakMinutes: Number(breakMinutes), breakStartTime, breakEndTime });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save working schedule");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-ink-900">Working days &amp; hours</h2>
      <p className="text-sm text-ink-500">Set the default schedule new employees will follow.</p>

      {error && (
        <div className="rounded-lg border border-danger-200 bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
          {error}
        </div>
      )}

      <Field label="Working days" required>
        <div className="flex flex-wrap gap-3">
          {DAYS.map((d) => (
            <Checkbox key={d.value} label={d.label} checked={workingDays.includes(d.value)} onChange={() => toggleDay(d.value)} />
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-3 gap-4">
        <Field label="Start time" required>
          <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
        </Field>
        <Field label="End time" required>
          <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
        </Field>
        <Field label="Break (minutes)" required>
          <Input type="number" min={0} value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} required />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Lunch break start" required>
          <Input type="time" value={breakStartTime} onChange={(e) => setBreakStartTime(e.target.value)} required />
        </Field>
        <Field label="Lunch break end" required>
          <Input type="time" value={breakEndTime} onChange={(e) => setBreakEndTime(e.target.value)} required />
        </Field>
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={saving || workingDays.length === 0}>
          {saving ? "Saving…" : "Save & continue"}
        </Button>
      </div>
    </div>
  );
}

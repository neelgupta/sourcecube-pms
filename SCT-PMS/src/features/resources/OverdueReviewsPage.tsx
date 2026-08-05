import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Badge, Button, Card, DatePicker, Field, Input } from "@/components/common";
import { api, ApiError } from "@/lib/api";
import { projectWorkspacePath } from "@/features/projects/projectRoutes";
import type { TaskOverdueReview } from "@/types/tenant";

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString() : "—";
}
function hoursFromMinutes(minutes: number) {
  return (minutes / 60).toFixed(1).replace(/\.0$/, "");
}

function ReviewRow({ review, onResolved }: { review: TaskOverdueReview; onResolved: (review: TaskOverdueReview) => void }) {
  const navigate = useNavigate();
  const [resolving, setResolving] = useState(false);
  const [estimateHours, setEstimateHours] = useState("");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trackedMinutes = Math.round(review.task.trackedSeconds / 60);

  async function resolve() {
    const newEstimatedMinutes = estimateHours.trim() ? Math.round(Number(estimateHours) * 60) : undefined;
    if (!newEstimatedMinutes && !dueDate) {
      setError("Provide a new estimate or a new due date");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { review: updated } = await api.resolveOverdueReview(review.id, { newEstimatedMinutes, newDueDate: dueDate ?? undefined });
      onResolved(updated);
      setResolving(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not resolve this review");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <button onClick={() => navigate(projectWorkspacePath(review.task.project))} className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-semibold text-ink-900">#{review.task.code} {review.task.name}</p>
          <p className="text-xs text-ink-500">{review.task.project.key} · {review.task.project.name}</p>
        </button>
        <Badge tone="red">Overdue</Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-ink-600 sm:grid-cols-4">
        <div><p className="text-ink-400">Assignee</p><p className="font-medium text-ink-800">{review.task.assignee?.name ?? "Unassigned"}</p></div>
        <div><p className="text-ink-400">Original due date</p><p className="font-medium text-ink-800">{formatDate(review.originalDueDate)}</p></div>
        <div><p className="text-ink-400">Estimate</p><p className="font-medium text-ink-800">{hoursFromMinutes(review.task.estimatedMinutes)}h</p></div>
        <div><p className="text-ink-400">Logged</p><p className="font-medium text-ink-800">{hoursFromMinutes(trackedMinutes)}h</p></div>
      </div>
      <div className="mt-3 rounded-lg bg-surface-muted p-3">
        <p className="text-xs font-semibold text-ink-500">Assignee's reason</p>
        <p className="mt-1 text-sm text-ink-800">{review.reason ?? <span className="italic text-ink-400">Not submitted yet</span>}</p>
      </div>
      {resolving ? (
        <div className="mt-3 space-y-2 border-t border-ink-100 pt-3">
          <div className="flex gap-3">
            <Field label="New estimate (hours)" className="flex-1">
              <Input type="number" min="0" step="0.5" value={estimateHours} onChange={(event) => setEstimateHours(event.target.value)} placeholder={hoursFromMinutes(review.task.estimatedMinutes)} />
            </Field>
            <Field label="New due date" className="flex-1">
              <DatePicker value={dueDate} onChange={setDueDate} />
            </Field>
          </div>
          {error && <p className="text-xs text-danger-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setResolving(false)} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={resolve} disabled={saving}>{saving ? "Saving…" : "Resolve"}</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex justify-end border-t border-ink-100 pt-3">
          <Button size="sm" onClick={() => setResolving(true)}>Re-estimate or reschedule</Button>
        </div>
      )}
    </Card>
  );
}

export function OverdueReviewsPage() {
  const [reviews, setReviews] = useState<TaskOverdueReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    api.listOverdueReviews()
      .then(({ reviews: rows }) => { setReviews(rows); setError(null); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Overdue reviews could not be loaded"))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  function onResolved(review: TaskOverdueReview) {
    setReviews((current) => current.filter((row) => row.id !== review.id));
  }

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center gap-2">
        <AlertTriangle size={20} className="text-warning-600" />
        <h1 className="text-lg font-semibold text-ink-900">Overdue task reviews</h1>
      </div>
      {loading ? (
        <p className="text-sm text-ink-500">Loading…</p>
      ) : error ? (
        <p className="text-sm text-danger-600">{error}</p>
      ) : reviews.length === 0 ? (
        <p className="rounded-lg border border-dashed border-ink-200 p-6 text-center text-sm text-ink-500">No tasks are awaiting your review.</p>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => <ReviewRow key={review.id} review={review} onResolved={onResolved} />)}
        </div>
      )}
    </div>
  );
}

import { Maximize2, MoreHorizontal } from "lucide-react";
import type { WidgetMetric } from "@/types";

export function WidgetTile({ metric }: { metric: WidgetMetric }) {
  return (
    <div className="group flex min-h-36 flex-col rounded-card border border-ink-200 bg-white shadow-card transition-shadow hover:shadow-card-hover">
      <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
        <p className="truncate text-sm font-semibold text-ink-900">{metric.label}</p>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <Maximize2 size={14} />
          </button>
          <button className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-5">
        <p className="text-3xl font-bold tracking-tight text-ink-900">{metric.value}</p>
      </div>
    </div>
  );
}

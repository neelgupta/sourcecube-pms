interface TooltipEntry {
  name?: string;
  value?: number;
  color?: string;
}

export const axisProps = {
  tick: { fill: "#94a3b8", fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

export const gridProps = {
  stroke: "#f1f5f9",
  strokeDasharray: "0",
  vertical: false,
} as const;

export function ChartTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string | number;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-ink-200 bg-white px-3 py-2 shadow-popover">
      <p className="text-xs font-medium text-ink-500">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="mt-0.5 flex items-center gap-2 text-sm font-semibold text-ink-900">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          {entry.value}
          {unit && <span className="font-normal text-ink-500">{unit}</span>}
        </p>
      ))}
    </div>
  );
}

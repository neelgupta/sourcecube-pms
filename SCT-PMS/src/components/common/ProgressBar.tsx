import { cn } from "@/lib/cn";

export function ProgressBar({
  value,
  className,
  tone = "auto",
}: {
  value: number;
  className?: string;
  tone?: "auto" | "brand" | "success";
}) {
  const pct = Math.min(100, Math.max(0, value));
  const barColor =
    tone === "brand"
      ? "bg-brand-500"
      : tone === "success"
        ? "bg-success-500"
        : pct >= 100
          ? "bg-success-500"
          : pct >= 50
            ? "bg-brand-500"
            : pct > 0
              ? "bg-warning-500"
              : "bg-ink-200";

  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-ink-100", className)}>
      <div
        className={cn("h-full rounded-full transition-all duration-500", barColor)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

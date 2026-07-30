import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/cn";

export function EmptyState({
  title = "No data to display",
  description,
  icon,
  action,
  className,
}: {
  title?: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ink-100 text-ink-400">
        {icon ?? <Inbox size={24} />}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-ink-700">{title}</p>
        {description && <p className="max-w-xs text-xs text-ink-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

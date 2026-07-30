import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
}

function useOutsideClose(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return ref;
}

export function DropdownMenu({
  trigger,
  items,
  align = "right",
}: {
  trigger: ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(() => setOpen(false));

  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open && (
        <div
          className={cn(
            "absolute z-30 mt-1.5 min-w-52 overflow-hidden rounded-lg border border-ink-200 bg-white py-1 shadow-popover",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {items.map((item) => (
            <button
              key={item.id}
              disabled={item.disabled}
              onClick={() => {
                item.onSelect?.();
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm transition-colors",
                item.danger ? "text-danger-600 hover:bg-danger-50" : "text-ink-700 hover:bg-ink-100",
                item.disabled && "cursor-not-allowed opacity-40",
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export function FilterSelect({
  value,
  options,
  onChange,
  icon,
  trailingIcon,
  className,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  icon?: ReactNode;
  /** Replaces the default chevron — e.g. a calendar glyph for month pickers. */
  trailingIcon?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(() => setOpen(false));
  const selected = options.find((o) => o.value === value);

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-100",
          open && "border-brand-500 ring-2 ring-brand-500/20",
        )}
      >
        <span className="flex items-center gap-2 truncate">
          {icon}
          {selected?.label ?? "Select"}
        </span>
        {trailingIcon ?? (
          <ChevronDown
            size={15}
            className={cn("shrink-0 text-ink-400 transition-transform", open && "rotate-180")}
          />
        )}
      </button>
      {open && (
        <div className="absolute z-30 mt-1.5 w-full min-w-max overflow-hidden rounded-lg border border-ink-200 bg-white py-1 shadow-popover">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-6 px-3.5 py-2 text-left text-sm text-ink-700 transition-colors hover:bg-ink-100"
            >
              {opt.label}
              {opt.value === value && <Check size={15} className="text-brand-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

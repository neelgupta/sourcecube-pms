import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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

/** Positions the menu via a body portal instead of a card-local `absolute` wrapper,
 *  so it always renders above sibling cards instead of being clipped/covered by
 *  whatever sits after it in normal document flow (e.g. the next grid row). */
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
  const [coords, setCoords] = useState<{ top: number; left: number; placement: "top" | "bottom" } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportPadding = 12;
      const estimatedHeight = 40 + items.length * 38;
      const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
      const spaceAbove = rect.top - viewportPadding;
      const placement = spaceBelow < estimatedHeight && spaceAbove > spaceBelow ? "top" : "bottom";
      setCoords({
        top: placement === "top" ? rect.top - 6 : rect.bottom + 6,
        left: align === "right" ? rect.right : rect.left,
        placement,
      });
    }
    updatePosition();
    function handleOutside(e: MouseEvent) {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, align]);

  return (
    <>
      <div ref={triggerRef} onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open && coords && createPortal(
        <div
          ref={menuRef}
          data-portal-panel
          style={{
            position: "fixed",
            top: coords.top,
            left: align === "right" ? undefined : coords.left,
            right: align === "right" ? window.innerWidth - coords.left : undefined,
            transform: coords.placement === "top" ? "translateY(-100%)" : undefined,
          }}
          className="z-[200] min-w-52 overflow-hidden rounded-lg border border-ink-200 bg-white py-1 shadow-popover"
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
        </div>,
        document.body,
      )}
    </>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

/** Portaled + viewport-positioned like DropdownMenu above — a plain `absolute` panel here
 *  would clip inside any scrollable/overflow-hidden ancestor (e.g. the horizontally
 *  scrolling filter chip row on the task list toolbar). */
export function FilterSelect({
  value,
  options,
  onChange,
  icon,
  trailingIcon,
  className,
  closeSignal,
  disabled,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  icon?: ReactNode;
  /** Replaces the default chevron — e.g. a calendar glyph for month pickers. */
  trailingIcon?: ReactNode;
  className?: string;
  closeSignal?: unknown;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; placement: "top" | "bottom" } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => setOpen(false), [closeSignal]);

  useEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 6;
      const viewportPadding = 12;
      const estimatedHeight = Math.min(300, 40 + options.length * 36);
      const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
      const spaceAbove = rect.top - viewportPadding;
      const placement = spaceBelow < estimatedHeight && spaceAbove > spaceBelow ? "top" : "bottom";
      setCoords({ top: placement === "top" ? rect.top - gap : rect.bottom + gap, left: rect.left, width: rect.width, placement });
    }
    updatePosition();
    function handleOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-ink-200 bg-white px-3 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-100",
          open && "border-brand-500 ring-2 ring-brand-500/20",
          disabled && "cursor-not-allowed opacity-50 hover:bg-white",
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
      {open && coords && createPortal(
        <div
          ref={panelRef}
          data-portal-panel
          style={{ position: "fixed", top: coords.top, left: coords.left, minWidth: coords.width, transform: coords.placement === "top" ? "translateY(-100%)" : undefined }}
          className="z-[200] w-max max-w-xs overflow-hidden rounded-lg border border-ink-200 bg-white py-1 shadow-popover"
        >
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
        </div>,
        document.body,
      )}
    </div>
  );
}

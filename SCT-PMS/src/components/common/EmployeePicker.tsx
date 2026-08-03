import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, ChevronDown, Search, Users, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Input } from "./Input";
import { MemberAvatar } from "./Avatar";

export interface EmployeePickerOption {
  id: string;
  name: string;
  email?: string;
  accountStatus?: string;
}

export interface EmployeePickerExtraOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

/** Searchable employee picker with a portaled, viewport-positioned dropdown (escapes
 *  clipping inside scrollable tables/drawers). Shared implementation used anywhere an
 *  assignee/employee needs to be picked by name — search matches name and email, but
 *  only the name is ever shown in the list. */
export function EmployeePicker({
  employees,
  value,
  onChange,
  disabled,
  excludeIds = [],
  placeholder = "Select employee",
  clearLabel = "Unassigned",
  allowClear = false,
  extraOptions,
  className,
}: {
  employees: EmployeePickerOption[];
  value?: string | null;
  onChange: (employeeId: string | null) => void;
  disabled?: boolean;
  excludeIds?: string[];
  placeholder?: string;
  clearLabel?: string;
  allowClear?: boolean;
  /** Extra pinned rows above the employee list (e.g. "All Users", "Unassigned") for
   *  filter-style usages where more than one non-employee state needs to be selectable. */
  extraOptions?: EmployeePickerExtraOption[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; placement: "top" | "bottom"; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selectedExtra = extraOptions?.find((option) => option.value === value);
  const selected = employees.find((employee) => employee.id === value);
  const available = employees.filter((employee) => !excludeIds.includes(employee.id) && `${employee.name} ${employee.email ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const choose = (employeeId: string | null) => {
    onChange(employeeId);
    setOpen(false);
    setQuery("");
  };

  useEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(rect.width, 280);
      const preferredHeight = 340;
      const gap = 6;
      const viewportPadding = 12;
      const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
      const spaceAbove = rect.top - viewportPadding;
      const placement = spaceBelow < 220 && spaceAbove > spaceBelow ? "top" : "bottom";
      const maxHeight = Math.max(180, Math.min(preferredHeight, placement === "top" ? spaceAbove - gap : spaceBelow - gap));
      setCoords({ top: placement === "top" ? rect.top - gap : rect.bottom + gap, left: rect.left, width, placement, maxHeight });
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
      <button ref={triggerRef} type="button" disabled={disabled} onClick={() => setOpen((current) => !current)} className="flex h-10 w-full items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 text-left text-sm transition hover:border-brand-300 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-ink-100">
        {selected ? (
          <MemberAvatar id={selected.id} name={selected.name} size="xs" status={selected.accountStatus === "active" ? "active" : "inactive"} />
        ) : selectedExtra?.icon ? selectedExtra.icon : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-100 text-[10px] font-semibold text-ink-500"><Users size={13} /></span>
        )}
        <span className={cn("min-w-0 flex-1 truncate", selected || selectedExtra ? "font-medium text-ink-800" : "text-ink-400")}>{selected?.name ?? selectedExtra?.label ?? placeholder}</span>
        <ChevronDown size={15} className={cn("shrink-0 text-ink-400 transition", open && "rotate-180")} />
      </button>
      {open && !disabled && coords && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: coords.top, left: coords.left, width: coords.width, maxHeight: coords.maxHeight, transform: coords.placement === "top" ? "translateY(-100%)" : undefined }}
          className="z-[80] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-popover"
        >
          <div className="border-b border-ink-100 p-2"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search employee..." leftIcon={<Search size={14} />} autoFocus /></div>
          <div className="overflow-y-auto p-1.5" style={{ maxHeight: Math.max(120, coords.maxHeight - 58) }}>
            {allowClear && <button type="button" onClick={() => choose(null)} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm text-ink-500 hover:bg-ink-50"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-100"><X size={13} /></span>{clearLabel}</button>}
            {extraOptions?.map((option) => (
              <button key={option.value} type="button" onClick={() => { onChange(option.value); setOpen(false); setQuery(""); }} className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-brand-50", option.value === value ? "bg-brand-50 text-ink-900" : "text-ink-700")}>
                {option.icon ?? <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-100"><Users size={13} className="text-ink-500" /></span>}
                <span className="min-w-0 flex-1 truncate font-medium">{option.label}</span>
                {option.value === value && <CheckCircle2 size={16} className="text-brand-600" />}
              </button>
            ))}
            {available.map((employee) => (
              <button key={employee.id} type="button" onClick={() => choose(employee.id)} className={cn("flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-brand-50", employee.id === value && "bg-brand-50")}>
                <MemberAvatar id={employee.id} name={employee.name} size="sm" status={employee.accountStatus === "active" ? "active" : "inactive"} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-800">{employee.name}</span>
                {employee.id === value && <CheckCircle2 size={16} className="text-brand-600" />}
              </button>
            ))}
            {available.length === 0 && <p className="px-3 py-5 text-center text-xs text-ink-400">No employees found</p>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

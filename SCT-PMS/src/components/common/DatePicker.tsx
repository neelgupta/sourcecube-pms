import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/cn";

const fieldBase =
  "w-full rounded-lg border border-ink-200 bg-white text-sm text-ink-900 placeholder:text-ink-400 transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-ink-100 disabled:text-ink-400";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** Parses a "YYYY-MM-DD" wire-format date (matches native input[type=date]) into a
 *  local-time Date at midnight, avoiding the UTC-parsing offset bug new Date(string) has. */
function parseDateValue(value?: string | null): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function toDateValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function displayFormat(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

/** Monday-first 6x7 grid of dates spanning the given month, including the leading/trailing
 *  days from adjacent months needed to fill whole weeks. */
function buildMonthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const firstWeekday = (first.getDay() + 6) % 7; // 0 = Monday
  const start = new Date(year, month, 1 - firstWeekday);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

function useFloatingPosition(open: boolean, triggerRef: React.RefObject<HTMLElement | null>, panelRef: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    function updatePosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCoords({ top: rect.bottom + 6, left: rect.left });
    }
    updatePosition();
    function handleOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("mousedown", handleOutside);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return coords;
}

function MonthNav({ cursor, onChange }: { cursor: Date; onChange: (next: Date) => void }) {
  return (
    <div className="flex items-center justify-between px-3 pt-3">
      <button type="button" onClick={() => onChange(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="rounded-lg p-1 text-ink-500 hover:bg-ink-100 hover:text-ink-900">
        <ChevronLeft size={16} />
      </button>
      <span className="text-sm font-semibold text-ink-900">{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
      <button type="button" onClick={() => onChange(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="rounded-lg p-1 text-ink-500 hover:bg-ink-100 hover:text-ink-900">
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

function WeekdayRow() {
  return (
    <div className="grid grid-cols-7 gap-0.5 px-3 pt-2 text-center text-[11px] font-semibold text-ink-400">
      {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
    </div>
  );
}

/** A single themed month-view calendar dropdown, replacing the browser's native
 *  input[type=date] picker with one that matches the app's design system and can be
 *  portaled to escape clipping inside scrollable tables/drawers (same pattern as
 *  EmployeePicker in ProjectDetailPage.tsx). Value/onChange use the same "YYYY-MM-DD"
 *  wire format the rest of the app already persists, so it's a drop-in replacement. */
export function DatePicker({
  value,
  onChange,
  placeholder = "Select date",
  disabled,
  min,
  max,
  allowClear = true,
  className,
}: {
  value?: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  min?: string | null;
  max?: string | null;
  allowClear?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseDateValue(value);
  const [cursor, setCursor] = useState(() => selected ?? new Date());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const coords = useFloatingPosition(open, triggerRef, panelRef, () => setOpen(false));
  const minDate = parseDateValue(min);
  const maxDate = parseDateValue(max);

  useEffect(() => {
    if (open) setCursor(selected ?? new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function isDisabled(date: Date) {
    if (minDate && date < minDate) return true;
    if (maxDate && date > maxDate) return true;
    return false;
  }

  function choose(date: Date) {
    if (isDisabled(date)) return;
    onChange(toDateValue(date));
    setOpen(false);
  }

  const grid = buildMonthGrid(cursor.getFullYear(), cursor.getMonth());
  const today = new Date();

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={cn(fieldBase, "flex h-10 items-center gap-2 px-3 text-left")}
      >
        <CalendarDays size={15} className="shrink-0 text-ink-400" />
        <span className={cn("min-w-0 flex-1 truncate", selected ? "text-ink-900" : "text-ink-400")}>
          {selected ? displayFormat(selected) : placeholder}
        </span>
        {allowClear && selected && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            onClick={(event) => { event.stopPropagation(); onChange(null); }}
            className="shrink-0 rounded p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
          >
            <X size={13} />
          </span>
        )}
      </button>

      {open && !disabled && coords && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: coords.top, left: coords.left }}
          className="z-[80] w-72 overflow-hidden rounded-xl border border-ink-200 bg-white pb-3 shadow-popover"
        >
          <MonthNav cursor={cursor} onChange={setCursor} />
          <WeekdayRow />
          <div className="grid grid-cols-7 gap-0.5 px-3 pt-1.5">
            {grid.map((date) => {
              const inMonth = date.getMonth() === cursor.getMonth();
              const isSelected = selected && isSameDay(date, selected);
              const isToday = isSameDay(date, today);
              const disabledDay = isDisabled(date);
              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  disabled={disabledDay}
                  onClick={() => choose(date)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full text-xs transition-colors",
                    !inMonth && "text-ink-300",
                    inMonth && !isSelected && "text-ink-700 hover:bg-brand-50",
                    isSelected && "bg-brand-600 font-semibold text-white hover:bg-brand-600",
                    !isSelected && isToday && "font-semibold text-brand-600",
                    disabledDay && "cursor-not-allowed opacity-30 hover:bg-transparent",
                  )}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-ink-100 px-3 pt-2">
            <button type="button" onClick={() => { onChange(null); setOpen(false); }} className="text-xs font-medium text-ink-500 hover:text-ink-800">Clear</button>
            <button
              type="button"
              onClick={() => { const now = new Date(); if (!isDisabled(now)) { onChange(toDateValue(now)); setOpen(false); } else setCursor(now); }}
              className="text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              Today
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Combined From/To range popover — a single calendar where clicking selects the range
 *  start, and the next click selects the end (swapping if picked out of order). Used for
 *  report filters where From/To are conceptually one range, not two independent dates. */
export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder = "Select date range",
  disabled,
  className,
}: {
  from?: string | null;
  to?: string | null;
  onChange: (range: { from: string | null; to: string | null }) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const fromDate = parseDateValue(from);
  const toDate = parseDateValue(to);
  const [cursor, setCursor] = useState(() => fromDate ?? new Date());
  const [pendingFrom, setPendingFrom] = useState<Date | null>(fromDate);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const coords = useFloatingPosition(open, triggerRef, panelRef, () => setOpen(false));

  useEffect(() => {
    if (open) {
      setCursor(fromDate ?? new Date());
      setPendingFrom(fromDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pick(date: Date) {
    if (!pendingFrom || (fromDate && toDate)) {
      setPendingFrom(date);
      onChange({ from: toDateValue(date), to: null });
      return;
    }
    if (date < pendingFrom) {
      onChange({ from: toDateValue(date), to: toDateValue(pendingFrom) });
    } else {
      onChange({ from: toDateValue(pendingFrom), to: toDateValue(date) });
    }
    setPendingFrom(null);
    setOpen(false);
  }

  const grid = buildMonthGrid(cursor.getFullYear(), cursor.getMonth());
  const today = new Date();
  const rangeStart = fromDate;
  const rangeEnd = toDate;

  function inRange(date: Date) {
    if (!rangeStart || !rangeEnd) return false;
    return date > rangeStart && date < rangeEnd;
  }

  const label = fromDate && toDate
    ? `${displayFormat(fromDate)} – ${displayFormat(toDate)}`
    : fromDate
    ? `${displayFormat(fromDate)} – …`
    : placeholder;

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={cn(fieldBase, "flex h-10 items-center gap-2 px-3 text-left")}
      >
        <CalendarDays size={15} className="shrink-0 text-ink-400" />
        <span className={cn("min-w-0 flex-1 truncate", fromDate ? "text-ink-900" : "text-ink-400")}>{label}</span>
        {(fromDate || toDate) && !disabled && (
          <span
            role="button"
            tabIndex={-1}
            onClick={(event) => { event.stopPropagation(); onChange({ from: null, to: null }); setPendingFrom(null); }}
            className="shrink-0 rounded p-0.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
          >
            <X size={13} />
          </span>
        )}
      </button>

      {open && !disabled && coords && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: coords.top, left: coords.left }}
          className="z-[80] w-72 overflow-hidden rounded-xl border border-ink-200 bg-white pb-3 shadow-popover"
        >
          <MonthNav cursor={cursor} onChange={setCursor} />
          <WeekdayRow />
          <div className="grid grid-cols-7 gap-0.5 px-3 pt-1.5">
            {grid.map((date) => {
              const inMonth = date.getMonth() === cursor.getMonth();
              const isStart = rangeStart && isSameDay(date, rangeStart);
              const isEnd = rangeEnd && isSameDay(date, rangeEnd);
              const isPendingStart = pendingFrom && !rangeEnd && isSameDay(date, pendingFrom);
              const isToday = isSameDay(date, today);
              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  onClick={() => pick(date)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full text-xs transition-colors",
                    !inMonth && "text-ink-300",
                    inMonth && !isStart && !isEnd && !isPendingStart && "text-ink-700 hover:bg-brand-50",
                    inRange(date) && "rounded-none bg-brand-50",
                    (isStart || isEnd || isPendingStart) && "bg-brand-600 font-semibold text-white hover:bg-brand-600",
                    !isStart && !isEnd && !isPendingStart && isToday && "font-semibold text-brand-600",
                  )}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-ink-100 px-3 pt-2">
            <button type="button" onClick={() => { onChange({ from: null, to: null }); setPendingFrom(null); setOpen(false); }} className="text-xs font-medium text-ink-500 hover:text-ink-800">Clear</button>
            <span className="text-[11px] text-ink-400">{pendingFrom && !rangeEnd ? "Pick end date" : "Pick start date"}</span>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

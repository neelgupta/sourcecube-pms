import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarDays } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/common";
import { ChartTooltip, axisProps, gridProps } from "./chartPrimitives";
import { rangePresetOptions, type RangePreset } from "../OverviewTab";

export function TaskActivityChart({
  data,
  preset,
  onPresetChange,
}: {
  data: { day: string; value: number }[];
  preset: RangePreset;
  onPresetChange: (preset: RangePreset) => void;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Task Activity"
        action={
          <div className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-medium text-ink-700">
            <CalendarDays size={14} className="text-ink-400" />
            <select value={preset} onChange={(event) => onPresetChange(event.target.value as RangePreset)} className="bg-transparent outline-none">
              {rangePresetOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        }
      />
      <CardBody className="pt-0">
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="taskActivityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1f9d6d" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#1f9d6d" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="day" {...axisProps} />
              <YAxis {...axisProps} allowDecimals={false} width={44} />
              <Tooltip content={<ChartTooltip unit="tasks" />} cursor={{ stroke: "#cbd5e1", strokeWidth: 1 }} />
              <Area
                type="monotone"
                dataKey="value"
                name="Tasks completed"
                stroke="#1f9d6d"
                strokeWidth={2}
                fill="url(#taskActivityFill)"
                dot={{ r: 3.5, fill: "#1f9d6d", strokeWidth: 2, stroke: "#fff" }}
                activeDot={{ r: 5.5, fill: "#1f9d6d", strokeWidth: 2, stroke: "#fff" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}

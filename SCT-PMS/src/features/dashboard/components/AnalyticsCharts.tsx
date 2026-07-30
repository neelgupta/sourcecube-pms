import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/common";
import { ChartTooltip, axisProps, gridProps } from "./chartPrimitives";

const priorityColors: Record<string, string> = {
  Low: "#1f9d6d",
  Medium: "#3b82f6",
  High: "#f59e0b",
  Critical: "#ef4444",
};

export function TasksByAssigneeCard({ data }: { data: { name: string; count: number }[] }) {
  return (
    <Card>
      <CardHeader title="Total tasks by Assignee" />
      <CardBody className="pt-0">
        {data.length === 0 ? (
          <EmptyState className="py-8" />
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 22, right: 20, left: 4, bottom: 4 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="name" {...axisProps} interval={0} padding={{ left: 16, right: 16 }} />
                <YAxis {...axisProps} width={52} allowDecimals={false} />
                <Tooltip content={<ChartTooltip unit="tasks" />} cursor={{ stroke: "#cbd5e1" }} />
                <Line
                  type="monotone"
                  dataKey="count"
                  name="Tasks"
                  stroke="#1f9d6d"
                  strokeWidth={2}
                  dot={{ r: 4, fill: "#1f9d6d", strokeWidth: 2, stroke: "#fff" }}
                  activeDot={{ r: 6, fill: "#1f9d6d", strokeWidth: 2, stroke: "#fff" }}
                >
                  <LabelList dataKey="count" position="top" offset={10} style={{ fill: "#334155", fontSize: 11, fontWeight: 600 }} />
                </Line>
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function TasksByPriorityCard({ data }: { data: { priority: string; count: number }[] }) {
  return (
    <Card>
      <CardHeader title="Total tasks by Priority" />
      <CardBody className="pt-0">
        {data.length === 0 ? (
          <EmptyState className="py-8" />
        ) : (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 22, right: 20, left: 4, bottom: 4 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="priority" {...axisProps} />
                <YAxis {...axisProps} width={52} allowDecimals={false} />
                <Tooltip content={<ChartTooltip unit="tasks" />} cursor={{ fill: "#f8fafc" }} />
                <Bar dataKey="count" name="Tasks" radius={[4, 4, 0, 0]} maxBarSize={54}>
                  {data.map((entry) => (
                    <Cell key={entry.priority} fill={priorityColors[entry.priority] ?? "#94a3b8"} />
                  ))}
                  <LabelList dataKey="count" position="top" offset={8} style={{ fill: "#334155", fontSize: 11, fontWeight: 600 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

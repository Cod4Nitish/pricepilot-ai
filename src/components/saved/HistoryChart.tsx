"use client";
import { useMemo } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PriceObservation } from "@/lib/saved/snapshot";
import { rupees } from "@/lib/shop-client";

const COLORS = ["#405dea", "#c2410c", "#047857", "#7c3aed", "#b45309", "#be123c"];

/** Line per retailer over real observations only. Rendered only when there are >= 2 observations. */
export default function HistoryChart({ points }: { points: PriceObservation[] }) {
  const { rows, retailers } = useMemo(() => {
    const retailers = Array.from(new Set(points.map((p) => p.retailer)));
    const rows = points
      .map((p) => ({ t: new Date(p.at).getTime(), [p.retailer]: p.price }) as Record<string, number>)
      .filter((r) => !Number.isNaN(r.t))
      .sort((a, b) => a.t - b.t);
    return { rows, retailers };
  }, [points]);
  return (
    <div className="h-56 w-full rounded-xl border border-line bg-surface p-2" role="img" aria-label={`Price observations chart, ${points.length} observations; the list below has every value`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t: number) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            stroke="var(--muted)"
            fontSize={11}
          />
          <YAxis stroke="var(--muted)" fontSize={11} width={72} tickFormatter={(v: number) => rupees(v)} domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--fg)" }}
            labelFormatter={(t) => new Date(Number(t)).toLocaleString("en-IN")}
            formatter={(v) => rupees(Number(v))}
          />
          <Legend />
          {retailers.map((r, i) => (
            <Line key={r} type="monotone" dataKey={r} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

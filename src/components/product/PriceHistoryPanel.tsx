"use client";
import { useMemo } from "react";
import Link from "next/link";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LineChart as LineIcon } from "lucide-react";
import type { PricePoint } from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { EmptyState } from "@/components/ui/state";

const COLORS: Record<string, string> = {
  amazon: "#f59e0b",
  flipkart: "#60a5fa",
  croma: "#34d399",
  reliance: "#fb7185",
  vijay: "#c084fc",
};

/** Chart of stored observations. Honest empty state: nothing is back-filled or estimated. */
export default function PriceHistoryPanel({ points, days }: { points: PricePoint[]; days: number }) {
  const { rows, retailers } = useMemo(() => {
    const rs = Array.from(new Set(points.map((p) => p.retailer)));
    const rows = points
      .map((p) => ({ t: new Date(p.observedAt).getTime(), [p.retailer]: p.price }) as Record<string, number>)
      .sort((a, b) => a.t - b.t);
    return { rows, retailers: rs };
  }, [points]);

  if (rows.length === 0) {
    return (
      <EmptyState icon={LineIcon} title="No price history yet">
        History builds up as prices are observed: each search records what it sees. Check back after a few searches over time. Nothing is back-filled or estimated.
        <span className="mt-2 block">
          <Link href="/search" className="font-medium text-primary underline">Run a search</Link>
        </span>
      </EmptyState>
    );
  }
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="h-72 w-full sm:h-80" role="img" aria-label={`Price history line chart, ${points.length} observations`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t: number) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              stroke="var(--muted)"
              fontSize={12}
            />
            <YAxis stroke="var(--muted)" fontSize={12} width={70} tickFormatter={(v: number) => formatINR(v)} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--fg)" }}
              labelFormatter={(t) => new Date(Number(t)).toLocaleString("en-IN")}
              formatter={(v) => formatINR(Number(v))}
            />
            <Legend />
            {retailers.map((r) => (
              <Line key={r} type="monotone" dataKey={r} stroke={COLORS[r] ?? "#6b97ff"} strokeWidth={2} dot connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-muted">{points.length} observation(s) in the last {days} days.</p>
    </div>
  );
}

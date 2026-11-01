"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Offer } from "@/lib/types";
import { api, loadLastSearch } from "@/lib/api-client";
import { formatINR } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import ErrorCard from "@/components/product/ErrorCard";

type Days = "7" | "30" | "90";
const COLORS: Record<string, string> = {
  amazon: "#f59e0b",
  flipkart: "#3b82f6",
  croma: "#10b981",
  reliance: "#ef4444",
  vijay: "#a855f7",
};

export default function HistoryView() {
  const params = useSearchParams();
  const router = useRouter();
  const key = params.get("key") ?? "";
  const [days, setDays] = useState<Days>("30");
  const [recent, setRecent] = useState<Offer[]>([]);
  useEffect(() => {
    const s = loadLastSearch();
    if (s) setRecent([...s.offers, ...s.excluded]);
  }, []);

  const q = useQuery({
    queryKey: ["history", key, days],
    queryFn: () => api.history(key, Number(days) as 7 | 30 | 90),
    enabled: key.length > 0,
  });

  const { rows, retailers } = useMemo(() => {
    const pts = q.data?.points ?? [];
    const rs = Array.from(new Set(pts.map((p) => p.retailer)));
    const rows = pts
      .map((p) => ({ t: new Date(p.observedAt).getTime(), [p.retailer]: p.price }) as Record<string, number>)
      .sort((a, b) => a.t - b.t);
    return { rows, retailers: rs };
  }, [q.data]);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">Price history</h1>
      {recent.length > 0 && (
        <div>
          <label htmlFor="hist-offer" className="mb-1 block text-sm text-muted">Product from your last search</label>
          <select
            id="hist-offer"
            value={key}
            onChange={(e) => router.push(`/history?key=${encodeURIComponent(e.target.value)}`)}
            className="h-11 w-full max-w-xl rounded-xl border border-line bg-surface2 px-3 text-sm"
          >
            <option value="">Select a product…</option>
            {recent.map((o) => (
              <option key={o.id} value={o.id}>
                {o.retailerName} - {o.title.slice(0, 70)}
              </option>
            ))}
          </select>
        </div>
      )}
      <Tabs
        label="Time range"
        value={days}
        onChange={setDays}
        items={[
          { value: "7", label: "7 days" },
          { value: "30", label: "30 days" },
          { value: "90", label: "90 days" },
        ]}
      />
      {!key && (
        <Card>
          <p className="text-sm text-muted">
            Pick a product from a search to see its tracked prices. <Link href="/search" className="text-primary underline">Search a product</Link>
          </p>
        </Card>
      )}
      {key && q.isPending && <Skeleton className="h-80 w-full" />}
      {key && q.isError && <ErrorCard error={q.error} onRetry={() => q.refetch()} />}
      {key && q.data &&
        (rows.length === 0 ? (
          <Card>
            <h2 className="font-display font-semibold">No history yet</h2>
            <p className="mt-1 text-sm text-muted">
              History accumulates as prices are observed. Each search records the prices it sees, so check back after a few searches over time. Nothing is back-filled or estimated.
            </p>
          </Card>
        ) : (
          <Card>
            <div className="h-80 w-full" role="img" aria-label="Price history line chart">
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
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12 }}
                    labelFormatter={(t) => new Date(Number(t)).toLocaleString("en-IN")}
                    formatter={(v) => formatINR(Number(v))}
                  />
                  <Legend />
                  {retailers.map((r) => (
                    <Line key={r} type="monotone" dataKey={r} stroke={COLORS[r] ?? "#4f83ff"} strokeWidth={2} dot connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-muted">{q.data.points.length} observation(s) in the last {days} days.</p>
          </Card>
        ))}
    </div>
  );
}

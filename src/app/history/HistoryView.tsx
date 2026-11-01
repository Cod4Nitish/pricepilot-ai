"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { Offer } from "@/lib/types";
import { api, loadLastSearch } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import PriceHistoryPanel from "@/components/product/PriceHistoryPanel";
import ErrorCard from "@/components/product/ErrorCard";

type Days = "7" | "30" | "90";
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

  return (
    <div className="space-y-6">
      <h1 className="font-display text-h1 font-bold">Price history</h1>
      {recent.length > 0 && (
        <div>
          <label htmlFor="hist-offer" className="mb-1 block text-sm text-muted">Product from your last search</label>
          <select
            id="hist-offer"
            value={key}
            onChange={(e) => router.push(`/history?key=${encodeURIComponent(e.target.value)}`)}
            className="h-11 w-full max-w-xl rounded-xl border border-line-strong bg-surface2 px-3 text-base sm:text-sm"
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
      {key && q.data && <PriceHistoryPanel points={q.data.points} days={Number(days)} />}
    </div>
  );
}

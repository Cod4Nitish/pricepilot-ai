"use client";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatElapsed } from "@/lib/shop-client";

export function CardSkeleton() {
  return (
    <div className="space-y-3 rounded-[1.1rem] border border-line bg-surface p-3 sm:p-4" aria-hidden>
      <div className="flex gap-3">
        <Skeleton className="aspect-square h-24 w-24 shrink-0 sm:h-32 sm:w-32" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9" />)}
      </div>
      <Skeleton className="h-20" />
      <div className="flex gap-2"><Skeleton className="h-11 flex-1" /><Skeleton className="h-11 w-24" /></div>
    </div>
  );
}

/** Neutral loading state: the server reports no step log before the response, so we show only real elapsed time. */
export function ShopLoading() {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setMs(Date.now() - start), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" className="text-sm text-muted">
        Searching retailers. This can take up to a minute. Elapsed <span className="tabular font-semibold text-fg">{formatElapsed(ms)}</span>
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}

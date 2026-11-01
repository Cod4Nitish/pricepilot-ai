"use client";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ChevronDown, Trophy } from "lucide-react";
import type { SearchResponse } from "@/lib/types";
import { api } from "@/lib/api-client";
import { formatINR, timeAgo } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ProductCard from "./ProductCard";
import RetailerStatusBar from "./RetailerStatusBar";
import VerificationBadge from "./VerificationBadge";

export function RunProgress({ runId }: { runId: string }) {
  const { data, isError } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => api.run(runId),
    refetchInterval: (q) => (q.state.data && (q.state.data.status === "completed" || q.state.data.status === "failed") ? false : 2000),
    staleTime: 0,
  });
  if (isError || !data) return null;
  return (
    <details className="rounded-xl border border-line bg-surface p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Agent run <Badge tone={data.status === "failed" ? "bad" : data.status === "completed" ? "good" : "brand"}>{data.status}</Badge>
      </summary>
      {data.error && <p className="mt-2 text-bad">{data.error}</p>}
      <ol className="mt-2 space-y-1 text-xs text-muted">
        {data.steps.map((s, i) => (
          <li key={i}>
            <span className={s.status === "error" ? "text-bad" : s.status === "warn" ? "text-warn" : "text-good"}>●</span> {s.label}{" "}
            <time dateTime={s.at}>({timeAgo(s.at)})</time>
          </li>
        ))}
        {data.steps.length === 0 && <li>No steps recorded.</li>}
      </ol>
    </details>
  );
}

export default function SearchResults({ data, showRun = true }: { data: SearchResponse; showRun?: boolean }) {
  const best = data.bestVerified;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>
          {data.offers.length} match{data.offers.length === 1 ? "" : "es"} for “{data.query}”
        </span>
        <span>· generated {timeAgo(data.generatedAt)}</span>
        {data.cached && <Badge>cached result</Badge>}
      </div>

      {best ? (
        <Card className="border-primary/40 bg-gradient-to-br from-primary/10 to-accent/10">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
            <Trophy className="h-4 w-4" aria-hidden /> Best verified price
          </div>
          <ProductCard offer={best} query={data.query} />
        </Card>
      ) : (
        <Card className="border-warn/40">
          <p className="flex items-center gap-2 font-display font-semibold">
            <AlertCircle className="h-5 w-5 text-warn" aria-hidden /> No verified price found
          </p>
          <p className="mt-1 text-sm text-muted">
            We could not confirm a price on a retailer page for this query, so no “best price” is claimed. Listed offers below are shown with their own
            verification labels.
          </p>
        </Card>
      )}

      <Card>
        <p className="text-sm">{data.recommendation.text}</p>
        {!data.recommendation.enoughEvidence && (
          <p className="mt-2 text-xs font-medium text-warn">Evidence is limited; treat this as a lead, not a guarantee.</p>
        )}
        {data.recommendation.caveats.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted">
            {data.recommendation.caveats.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        )}
      </Card>

      <RetailerStatusBar statuses={data.statuses} />

      {data.offers.length > 0 ? (
        <section aria-label="All matching offers" className="space-y-4">
          <h2 className="font-display text-lg font-semibold">All matches, lowest price first</h2>
          {data.offers.map((o) => (
            <ProductCard key={o.id} offer={o} query={data.query} />
          ))}
        </section>
      ) : (
        <Card>
          <p className="text-sm text-muted">No confident matches were found across the retailers checked. Try a more specific model name or check the retailer statuses above.</p>
        </Card>
      )}

      {data.excluded.length > 0 && (
        <details className="group rounded-2xl border border-line bg-surface p-4">
          <summary className="flex cursor-pointer list-none items-center justify-between font-display font-semibold">
            <span>Excluded / low-confidence matches ({data.excluded.length})</span>
            <ChevronDown className="h-5 w-5 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="mt-2 text-xs text-muted">These looked different from what you searched for. They are never ranked as the cheapest.</p>
          <ul className="mt-3 space-y-2">
            {data.excluded.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <a href={o.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 font-medium hover:text-primary">
                    {o.title}
                  </a>
                  <p className="text-xs text-muted">
                    {o.retailerName} · {formatINR(o.price)} · {o.matchNotes.join(" · ") || "low match confidence"}
                  </p>
                </div>
                <VerificationBadge value={o.verification} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {showRun && <RunProgress runId={data.runId} />}
    </div>
  );
}

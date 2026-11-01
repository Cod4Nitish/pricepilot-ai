"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, Star } from "lucide-react";
import type { ProductGroup } from "@/lib/shop/types";
import { api } from "@/lib/api-client";
import { componentPct, rupees, scoreLabel } from "@/lib/shop-client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProductImage } from "@/components/product/ProductCard";

export default function ProductRecommendationCard({
  group,
  selected,
  expanded,
  onCompare,
  extraActions,
}: {
  group: ProductGroup;
  selected: boolean;
  expanded: boolean;
  onCompare: () => void;
  /** e.g. the local "Save product" action */
  extraActions?: React.ReactNode;
}) {
  const [showAllScore, setShowAllScore] = useState(false);
  const watch = useMutation({
    mutationFn: () => api.addWatch({ productQuery: group.name, title: group.name, imageUrl: group.imageUrl ?? undefined, lastPrice: group.lowestVerified?.price ?? null }),
  });
  const specs = group.specs.slice(0, 6);
  const score = group.score;
  const comps = score ? (showAllScore ? score.components : score.components.slice(0, 4)) : [];
  const provisional = group.provisional || score?.provisional;
  const needsSignIn = watch.isError && /sign in/i.test((watch.error as Error).message);

  return (
    <article
      aria-labelledby={`g-${group.id}-h`}
      className={cn("lift-3d space-y-3 rounded-[1.1rem] border bg-surface p-3 shadow-card sm:p-4", selected ? "border-primary" : "border-line")}
    >
      <div className="flex gap-3">
        <div className="tilt-3d shrink-0"><ProductImage src={group.imageUrl ?? undefined} alt={group.name} className="aspect-square h-24 w-24 sm:h-32 sm:w-32" /></div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">#{group.rank}</Badge>
            {provisional && <Badge tone="warn" className="border-fg/30 bg-sun text-fg">PROVISIONAL</Badge>}
          </div>
          <h3 id={`g-${group.id}-h`} className="font-display text-base font-semibold leading-snug">{group.name}</h3>
          {group.lowestVerified ? (
            <p className="text-sm">
              Verified lowest price <span className="tabular font-bold">{rupees(group.lowestVerified.price)}</span> at {group.lowestVerified.retailer}
            </p>
          ) : (
            <p className="text-sm text-muted">Price not verified yet</p>
          )}
        </div>
      </div>

      {specs.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          {specs.map((s) => (
            <div key={s.key} className="min-w-0">
              <dt className="text-xs text-muted">{s.label}</dt>
              <dd className="break-words text-sm font-medium">
                {s.value}
                {s.unit ? ` ${s.unit}` : ""}{" "}
                <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" title={s.evidence} className="text-xs font-normal text-primary underline">
                  source<span className="sr-only"> for {s.label} (opens in a new tab)</span>
                </a>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {score && (
        <section aria-label="Product Fit Score" className="rounded-xl bg-surface2 p-3">
          <p className="eyebrow">At a glance</p>
          <p className="mt-1 text-sm font-semibold">
            Product Fit Score:{" "}
            {score.total !== null ? <span className="tabular">{Math.round(score.total)}/100</span> : <span className="text-muted">Not enough evidence to score</span>}
          </p>
          <p className="text-xs text-muted">How well this product&apos;s sourced specs match your request. Not a store or price rating.</p>
          <ul className="mt-2 space-y-1.5">
            {comps.map((c) => {
              const pct = componentPct(c.score);
              return (
                <li key={c.name} title={c.basis}>
                  <div className="flex justify-between text-xs">
                    <span>{scoreLabel(c.name)}</span>
                    <span className={cn("tabular", pct === null && "text-muted")}>{pct === null ? "Not found" : `${pct}%`}</span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-line" role="presentation">
                    {pct !== null && <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />}
                  </div>
                </li>
              );
            })}
          </ul>
          {score.components.length > 4 && (
            <button type="button" onClick={() => setShowAllScore((v) => !v)} className="mt-1 min-h-11 cursor-pointer text-xs font-semibold text-primary underline">
              {showAllScore ? "Show fewer" : `Show all ${score.components.length} factors`}
            </button>
          )}
          {score.provisional && score.missing.length > 0 && (
            <p className="mt-1 text-xs text-warn">Missing evidence: {score.missing.join(", ")}.</p>
          )}
        </section>
      )}

      {group.why.length > 0 && (
        <div>
          <p className="eyebrow">Why recommended</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {group.why.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button className="flex-1 sm:flex-none" onClick={onCompare} aria-expanded={expanded} aria-controls={`detail-${group.id}`}>
          Compare prices ({group.offers.length}) <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} aria-hidden />
        </Button>
        <Button variant="secondary" onClick={() => watch.mutate()} disabled={watch.isPending || watch.isSuccess}>
          <Star className="h-4 w-4" aria-hidden /> {watch.isSuccess ? "Watching" : watch.isPending ? "Adding" : "Watchlist"}
        </Button>
        {extraActions}
      </div>
      <p role="status" className="text-xs empty:hidden">
        {watch.isError && !needsSignIn && <span className="text-bad">{(watch.error as Error).message}</span>}
        {needsSignIn && (
          <span>
            Sign in to use the account watchlist.{" "}
            <Link href="/settings#account" className="text-primary underline">Go to sign in</Link>
          </span>
        )}
        {watch.isSuccess && <span className="text-good">Added to your watchlist.</span>}
      </p>
    </article>
  );
}

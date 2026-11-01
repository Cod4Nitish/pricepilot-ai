"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, Star, Tag, Truck } from "lucide-react";
import type { Offer } from "@/lib/types";
import { api } from "@/lib/api-client";
import { cn, formatINR, timeAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import VerificationBadge from "./VerificationBadge";

export function ProductImage({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={cn("grid place-items-center rounded-xl bg-surface2 text-xs text-muted", className)} role="img" aria-label="No image available">
        No image
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={cn("rounded-xl bg-white object-contain", className)} />;
}

const AVAIL = {
  in_stock: { label: "In stock", tone: "good" },
  out_of_stock: { label: "Out of stock", tone: "bad" },
  unknown: { label: "Availability unknown", tone: "neutral" },
} as const;

export default function ProductCard({
  offer,
  query,
  detail = true,
  best = false,
}: {
  offer: Offer;
  query?: string;
  detail?: boolean;
  /** Set only for the search's bestVerified offer. */
  best?: boolean;
}) {
  const av = AVAIL[offer.availability];
  const isBest = best && (offer.verification === "verified" || offer.verification === "agent_verified");
  const watch = useMutation({
    mutationFn: () =>
      api.addWatch({ productQuery: query ?? offer.title, title: offer.title, imageUrl: offer.imageUrl, lastPrice: offer.price }),
  });
  const hasMrp = offer.mrp !== null && offer.price !== null && offer.mrp !== offer.price;
  const specChips = [
    offer.spec.storageGb ? `${offer.spec.storageGb} GB` : null,
    offer.spec.ramGb ? `${offer.spec.ramGb} GB RAM` : null,
    offer.spec.color ?? null,
    offer.spec.condition && offer.spec.condition !== "unknown" ? offer.spec.condition : null,
  ].filter(Boolean) as string[];

  return (
    <article
      aria-label={offer.title}
      className={cn(
        "rounded-2xl border bg-surface p-3 shadow-card transition-colors sm:p-4",
        isBest ? "border-good/60" : "border-line hover:border-line-strong",
      )}
    >
      <div className="flex gap-3 sm:gap-4">
        <ProductImage src={offer.imageUrl} alt={offer.title} className="h-24 w-24 shrink-0 sm:h-32 sm:w-32" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="brand">{offer.retailerName}</Badge>
            {isBest && <span className="rounded-full bg-good px-2.5 py-1 text-[11px] font-bold uppercase leading-none tracking-wide text-bg">Best verified</span>}
            <VerificationBadge value={offer.verification} />
            <Badge tone={av.tone}>{av.label}</Badge>
          </div>
          <h3 className="line-clamp-2 font-display text-[0.95rem] font-semibold leading-snug sm:text-base">{offer.title}</h3>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="tabular font-display text-2xl font-bold">{formatINR(offer.price)}</span>
            {hasMrp && <span className="tabular text-sm text-muted line-through">{formatINR(offer.mrp)}</span>}
            {offer.discountPct !== null && offer.discountPct > 0 && (
              <span className="rounded-md bg-good/10 px-1.5 py-0.5 text-sm font-semibold text-good">{Math.round(offer.discountPct)}% off</span>
            )}
          </div>
          {specChips.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Specifications">
              {specChips.map((c) => (
                <li key={c} className="rounded-md bg-surface2 px-2 py-0.5 text-xs font-medium capitalize text-fg">{c}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-muted sm:grid-cols-4">
        <div>
          <dt className="flex items-center gap-1"><Truck className="h-3.5 w-3.5" aria-hidden /> Delivery</dt>
          <dd className="font-medium text-fg">{offer.deliveryCharge === null ? "Unknown" : offer.deliveryCharge === 0 ? "Free" : formatINR(offer.deliveryCharge)}</dd>
        </div>
        <div>
          <dt>Seller</dt>
          <dd className="truncate font-medium text-fg">{offer.seller ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Last checked</dt>
          <dd className="font-medium text-fg"><time dateTime={offer.checkedAt}>{timeAgo(offer.checkedAt)}</time></dd>
        </div>
        <div>
          <dt>Match confidence</dt>
          <dd className="font-medium text-fg">{Math.round(offer.matchConfidence * 100)}%</dd>
        </div>
      </dl>

      {(offer.offers.length > 0 || offer.evidence || offer.matchNotes.length > 0) && (
        <div className="mt-3 space-y-2">
          {offer.offers.length > 0 && (
            <details className="rounded-xl border border-line bg-surface2 text-xs">
              <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 px-3 font-semibold">
                <Tag className="h-3.5 w-3.5" aria-hidden /> {offer.offers.length} offer{offer.offers.length === 1 ? "" : "s"} listed on the page
                <span className="font-normal text-warn">(conditions not verified)</span>
              </summary>
              <ul className="list-disc space-y-0.5 border-t border-line px-3 py-2 pl-7 text-muted">
                {offer.offers.slice(0, 6).map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </details>
          )}
          {offer.evidence && (
            <details className="rounded-xl border border-line bg-surface2 text-xs">
              <summary className="min-h-10 cursor-pointer list-none px-3 py-2.5 font-semibold text-primary">Show evidence from the page</summary>
              <blockquote className="border-t border-line px-3 py-2 text-muted">{offer.evidence}</blockquote>
            </details>
          )}
          {offer.matchNotes.length > 0 && <p className="text-xs text-muted">{offer.matchNotes.join(" · ")}</p>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button asChild size="sm" variant={isBest ? "primary" : "secondary"} className="flex-1 sm:flex-none">
          <a href={offer.url} target="_blank" rel="noopener noreferrer">
            Buy on {offer.retailerName} <ExternalLink className="h-4 w-4" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Button>
        {detail && (
          <Button asChild size="sm" variant="secondary">
            <Link href={`/product/${encodeURIComponent(offer.id)}`}>Compare details</Link>
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => watch.mutate()} disabled={watch.isPending || watch.isSuccess}>
          <Star className="h-4 w-4" aria-hidden /> {watch.isSuccess ? "Tracking" : "Track price"}
        </Button>
      </div>
      <p role="status" className="mt-1 text-xs empty:hidden">
        {watch.isError && <span className="text-bad">{(watch.error as Error).message}{" "}</span>}
        {watch.isError && /sign in/i.test((watch.error as Error).message) && (
          <Link href="/settings" className="text-primary underline">Go to sign in</Link>
        )}
        {watch.isSuccess && <span className="text-good">Added to your watchlist.</span>}
      </p>
    </article>
  );
}

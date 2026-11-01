import { ExternalLink, Truck } from "lucide-react";
import type { Offer } from "@/lib/types";
import { cn, formatINR, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import VerificationBadge from "./VerificationBadge";

export function deliveryText(d: number | null): string {
  return d === null ? "Unknown" : d === 0 ? "Free" : formatINR(d);
}

/**
 * One retailer's price for a product. `best` should be set ONLY for the search's bestVerified offer;
 * the BEST VERIFIED tag is also suppressed unless the offer is actually verified.
 */
export default function RetailerPriceCard({ offer, best = false, className }: { offer: Offer; best?: boolean; className?: string }) {
  const isBest = best && (offer.verification === "verified" || offer.verification === "agent_verified");
  const hasMrp = offer.mrp !== null && offer.price !== null && offer.mrp !== offer.price;
  return (
    <article
      aria-label={`${offer.retailerName} price`}
      className={cn(
        "flex flex-col gap-3 rounded-2xl border bg-surface p-4",
        isBest ? "border-good/60 shadow-[0_0_0_1px_var(--good)]" : "border-line",
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display font-semibold">{offer.retailerName}</h3>
        {isBest && (
          <span className="inline-flex items-center gap-1 rounded-full bg-good px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-bg">
            Best verified
          </span>
        )}
      </header>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tabular font-display text-2xl font-bold">{formatINR(offer.price)}</span>
        {hasMrp && <span className="tabular text-sm text-muted line-through">MRP {formatINR(offer.mrp)}</span>}
        {offer.discountPct !== null && offer.discountPct > 0 && (
          <span className="rounded-md bg-good/10 px-1.5 py-0.5 text-sm font-semibold text-good">{Math.round(offer.discountPct)}% off</span>
        )}
      </div>
      <VerificationBadge value={offer.verification} detail />
      <p className="flex items-center gap-1.5 text-xs text-muted">
        <Truck className="h-3.5 w-3.5" aria-hidden /> Delivery: <span className="font-medium text-fg">{deliveryText(offer.deliveryCharge)}</span>
        <span aria-hidden>·</span> Checked <time dateTime={offer.checkedAt}>{timeAgo(offer.checkedAt)}</time>
      </p>
      {offer.evidence ? (
        <details className="rounded-xl border border-line bg-surface2 text-xs">
          <summary className="min-h-10 cursor-pointer list-none px-3 py-2.5 font-semibold text-primary">Show evidence from the page</summary>
          <blockquote className="border-t border-line px-3 py-2 text-muted">{offer.evidence}</blockquote>
        </details>
      ) : (
        <p className="text-xs text-muted">No page evidence snippet was captured for this price.</p>
      )}
      <Button asChild variant={isBest ? "primary" : "secondary"} className="mt-auto">
        <a href={offer.url} target="_blank" rel="noopener noreferrer">
          Buy on {offer.retailerName} <ExternalLink className="h-4 w-4" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </Button>
    </article>
  );
}

"use client";
import { ExternalLink, Loader2, Truck } from "lucide-react";
import type { ShopOffer } from "@/lib/shop/types";
import { deliveryHeadline, discountLabel, relativeTime, rupees, shippingLabel } from "@/lib/shop-client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import VerificationBadge from "@/components/product/VerificationBadge";
import TrueCostBreakdown from "./TrueCostBreakdown";

const STOCK = {
  in_stock: { label: "In stock", tone: "good" },
  out_of_stock: { label: "Out of stock", tone: "bad" },
  unknown: { label: "Stock unknown", tone: "neutral" },
} as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="break-words text-sm font-medium">{children}</dd>
    </div>
  );
}

export default function RetailerOfferCard({
  offer,
  pin,
  tags = [],
  deliveryLoading = false,
  onCheckDelivery,
}: {
  offer: ShopOffer;
  pin: string | null;
  tags?: string[];
  deliveryLoading?: boolean;
  onCheckDelivery?: () => void;
}) {
  const stock = STOCK[offer.stockStatus];
  const d = deliveryHeadline(offer.delivery, pin);
  const disc = discountLabel(offer);
  const showMrp = offer.mrp !== null && offer.listedPrice !== null && offer.mrp > offer.listedPrice;
  const title = offer.productName;
  const variantBits = [
    offer.variant.storageGb ? `${offer.variant.storageGb} GB` : null,
    offer.variant.ramGb ? `${offer.variant.ramGb} GB RAM` : null,
    offer.variant.color,
    offer.variant.condition && offer.variant.condition !== "new" ? offer.variant.condition : null,
  ].filter(Boolean);
  const checked = offer.observedAt;

  return (
    <article aria-label={`${offer.retailer} offer`} className="lift-3d space-y-3 rounded-[1.1rem] border border-line bg-surface p-3 shadow-card sm:p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="grid h-8 min-w-8 place-items-center rounded-lg bg-primary/10 px-2 text-sm font-bold text-primary" aria-hidden>
          {offer.retailer.slice(0, 2).toUpperCase()}
        </span>
        <h4 className="font-display text-base font-semibold">{offer.retailer}</h4>
        {tags.map((t) => (
          <Badge key={t} tone="brand">{t}</Badge>
        ))}
        <VerificationBadge value={offer.verificationStatus} />
      </div>

      <div>
        <p className="line-clamp-2 text-sm font-medium">{title}</p>
        {variantBits.length > 0 && <p className="text-xs capitalize text-muted">{variantBits.join(" · ")}</p>}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="eyebrow">Listed price</span>
        <span className="tabular font-display text-2xl font-bold">{rupees(offer.listedPrice)}</span>
        {showMrp && <span className="tabular text-sm text-muted line-through"><span className="sr-only">MRP </span>{rupees(offer.mrp)}</span>}
        {disc && <span className="rounded-md bg-good/10 px-1.5 py-0.5 text-sm font-semibold text-good">{disc}</span>}
      </div>

      <div className="rounded-xl bg-surface2 px-3 py-2 text-sm">
        {offer.effectiveTotal !== null ? (
          <p>
            <span className="text-muted">{offer.totalIsLowerBound ? "Lower bound" : "Verified payable total"}: </span>
            <span className="tabular font-semibold">{rupees(offer.effectiveTotal)}</span>
            {offer.totalIsLowerBound && <span className="block text-xs text-muted">Some fees may still apply.</span>}
          </p>
        ) : (
          <p className="text-muted">Payable total not verified (shipping or fees unknown).</p>
        )}
      </div>

      {offer.trueCost && <TrueCostBreakdown tc={offer.trueCost} commerceMode={offer.commerceMode} />}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Row label="Shipping">{shippingLabel(offer.shippingFee)}</Row>
        <Row label="Stock"><Badge tone={stock.tone} className={stock.tone === "good" ? "border-fg/30 bg-mint text-fg" : undefined}>{stock.label}</Badge></Row>
        <Row label="Seller">{offer.seller ?? "Not listed"}</Row>
        <Row label="Warranty">{offer.warranty ?? "Not listed"}</Row>
        <Row label="Returns">{offer.returnPolicy ?? "Not listed"}</Row>
      </dl>

      <div className="rounded-xl border border-line p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            <Truck className="h-3.5 w-3.5" aria-hidden /> Delivery{pin ? ` to ${pin}` : ""}
          </p>
          {onCheckDelivery && (
            <Button size="sm" variant="ghost" className="-my-1 h-10 shrink-0" onClick={onCheckDelivery} disabled={deliveryLoading || !pin}>
              {deliveryLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {deliveryLoading ? "Checking" : offer.delivery.kind === "not_verified" ? "Check" : "Re-check"}
            </Button>
          )}
        </div>
        <p
          className={cn("text-sm font-medium", d.tone === "bad" && "text-bad", d.tone === "warn" && "text-warn")}
          aria-live="polite"
        >
          {deliveryLoading ? "Checking delivery..." : d.text}
        </p>
        {!deliveryLoading && d.sub && <p className="text-xs text-muted">{d.sub}</p>}
        {!pin && <p className="text-xs text-muted">Set a pincode to check delivery.</p>}
      </div>

      {offer.conditionalOffers.length > 0 && (
        <div className="text-sm">
          <p className="text-xs font-semibold text-muted">
            Payment offers <span className="font-normal text-warn">(conditions not verified)</span>
          </p>
          <ul className="mt-1 space-y-1">
            {offer.conditionalOffers.map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1.5 text-xs">
                <span>{c.text}</span>
                <Badge tone={c.applied ? "good" : "neutral"}>{c.applied ? "Applied" : "Not applied"}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted">
        Verified <time dateTime={checked} title={new Date(checked).toString()}>{relativeTime(checked)}</time>
      </p>

      {(offer.evidence.length > 0 || offer.sourceUrl) && (
        <details className="rounded-xl border border-line bg-surface2 text-xs">
          <summary className="eyebrow flex min-h-11 cursor-pointer list-none items-center px-3 text-primary">Source evidence</summary>
          <div className="space-y-2 border-t border-line px-3 py-2 text-muted">
            {offer.evidence.map((e, i) => (
              <blockquote key={i} className="break-words">&ldquo;{e.text}&rdquo;</blockquote>
            ))}
            <a href={offer.sourceUrl} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline">
              {offer.sourceUrl}
            </a>
          </div>
        </details>
      )}

      <Button asChild className="w-full">
        <a href={offer.sourceUrl} target="_blank" rel="noopener noreferrer">
          Buy on {offer.retailer} <ExternalLink className="h-4 w-4" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </Button>
    </article>
  );
}

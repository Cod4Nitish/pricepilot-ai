"use client";
// Read-only rendering of a saved snapshot group. Pure presentation of stored data: no fetching, no live claims.
import { ExternalLink, History } from "lucide-react";
import type { TrueCostVerdict } from "@/lib/engine/ecommerce/truecost";
import type { SavedGroup, SavedOffer, SavedPick } from "@/lib/saved/snapshot";
import { deliveryHeadline, relativeTime, rupees } from "@/lib/shop-client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import VerificationBadge from "@/components/product/VerificationBadge";
import { ProductImage } from "@/components/product/ProductCard";
import TrueCostBreakdown, { TrueCostVerdictPanel } from "@/components/shop/TrueCostBreakdown";

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "unknown date";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "unknown date" : d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Oldest price observation time among the snapshot's offers (falls back to research time). */
export function snapshotObservedAt(g: SavedGroup, fallback: string): string {
  const ts = g.offers.map((o) => new Date(o.observedAt).getTime()).filter((t) => !Number.isNaN(t));
  return ts.length ? new Date(Math.min(...ts)).toISOString() : fallback;
}

/** The prominent "this is a saved snapshot, not live" label. */
export function SnapshotBanner({ observedAt, savedAt, kind = "prices" }: { observedAt: string; savedAt: string; kind?: "prices" | "research" }) {
  return (
    <p role="note" className="flex items-start gap-2 rounded-xl border border-fg/30 bg-sun px-3 py-2 text-sm font-semibold text-fg">
      <History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        Saved snapshot · {kind === "prices" ? "prices observed" : "research generated"}{" "}
        <time dateTime={observedAt}>{relativeTime(observedAt)}</time> ({formatDate(observedAt)}) · may be outdated
        <span className="block text-xs font-normal">Saved {formatDate(savedAt)}. Not live: use Refresh to check current prices.</span>
      </span>
    </p>
  );
}

const STOCK = {
  in_stock: { label: "In stock", tone: "good" },
  out_of_stock: { label: "Out of stock", tone: "bad" },
  unknown: { label: "Stock unknown", tone: "neutral" },
} as const;

export function SavedOfferCard({ offer }: { offer: SavedOffer }) {
  const stock = STOCK[offer.stockStatus];
  const d = deliveryHeadline(offer.delivery, offer.delivery.pincode);
  return (
    <article aria-label={`${offer.retailer} offer (saved)`} className="space-y-3 rounded-[1.1rem] border border-line bg-surface p-3 shadow-card sm:p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <h4 className="font-display text-base font-semibold">{offer.retailer}</h4>
        <VerificationBadge value={offer.verificationStatus} />
      </div>
      {offer.productName && <p className="line-clamp-2 text-sm font-medium">{offer.productName}</p>}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="eyebrow">Listed price (saved)</span>
        <span className="tabular font-display text-2xl font-bold">{rupees(offer.listedPrice)}</span>
      </div>
      {offer.trueCost && <TrueCostBreakdown tc={offer.trueCost} commerceMode={offer.commerceMode} />}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div className="min-w-0">
          <dt className="text-xs text-muted">Stock (when saved)</dt>
          <dd><Badge tone={stock.tone} className={stock.tone === "good" ? "border-fg/30 bg-mint text-fg" : undefined}>{stock.label}</Badge></dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Delivery (when saved)</dt>
          <dd className={cn("break-words text-sm font-medium", d.tone === "bad" && "text-bad", d.tone === "warn" && "text-warn")}>
            {d.text}
            {d.sub && <span className="block text-xs font-normal text-muted">{d.sub}</span>}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted">
        Price observed <time dateTime={offer.observedAt}>{relativeTime(offer.observedAt)}</time> ({formatDate(offer.observedAt)})
      </p>
      {offer.sourceUrl ? (
        <Button asChild variant="secondary" className="w-full">
          <a href={offer.sourceUrl} target="_blank" rel="noopener noreferrer">
            Open on {offer.retailer} <ExternalLink className="h-4 w-4" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Button>
      ) : (
        <p className="text-xs text-muted">Store link not saved (it did not pass link validation).</p>
      )}
    </article>
  );
}

function PickTile({ title, pick, kind }: { title: string; pick: SavedPick | null; kind: "price" | "eta" | "best" }) {
  const value = pick?.value === null || pick?.value === undefined ? null : typeof pick.value === "number" ? (kind === "best" ? `Score ${Math.round(pick.value)}` : rupees(pick.value)) : pick.value;
  return (
    <li className="rounded-[1.1rem] border border-line bg-surface p-3">
      <p className="eyebrow">{title}</p>
      {pick ? (
        <>
          <p className="mt-1 font-display text-lg font-bold">{pick.retailer}</p>
          {value && <p className="tabular text-sm font-semibold">{value}</p>}
          {(pick.reasons.length > 0 || pick.conditions.length > 0 || pick.evidence.length > 0) && (
            <details className="mt-1 text-xs">
              <summary className="flex min-h-11 cursor-pointer list-none items-center font-semibold text-primary">Reasons, conditions, evidence</summary>
              <div className="space-y-2 text-muted">
                {pick.reasons.length > 0 && <ul className="list-disc pl-4">{pick.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
                {pick.conditions.length > 0 && (
                  <div><p className="font-semibold text-fg">Conditions</p><ul className="list-disc pl-4">{pick.conditions.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
                )}
                {pick.evidence.length > 0 && (
                  <div><p className="font-semibold text-fg">Evidence</p><ul className="list-disc break-all pl-4">{pick.evidence.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
                )}
              </div>
            </details>
          )}
        </>
      ) : (
        <p className="mt-1 text-sm font-medium text-muted">Not enough verified data</p>
      )}
    </li>
  );
}

function toVerdict(g: SavedGroup): TrueCostVerdict | null {
  const v = g.verdict;
  if (!v) return null;
  const r = (x: { retailer: string; value: number } | null) => (x ? { offerId: "", retailer: x.retailer, value: x.value } : null);
  return {
    cheapestConfirmed: r(v.cheapestConfirmed),
    lowestListed: r(v.lowestListed),
    lowestKnownMinimum: r(v.lowestKnownMinimum),
    tiedLowestListed: Array.from({ length: v.tiedLowestListedCount }, () => ""),
    notes: v.notes,
  };
}

export function SavedSpecs({ g }: { g: SavedGroup }) {
  if (g.specs.length === 0) return <p className="text-sm text-muted">No verified specs were saved.</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
      {g.specs.map((s) => (
        <div key={s.key + s.label} className="min-w-0">
          <dt className="text-xs text-muted">{s.label}</dt>
          <dd className="break-words text-sm font-medium">
            {s.value}
            {s.unit ? ` ${s.unit}` : ""}{" "}
            <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" title={s.evidence} className="relative text-xs font-normal text-primary underline after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-['']">
              source<span className="sr-only"> for {s.label} (opens in a new tab)</span>
            </a>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function variantLabel(v: SavedGroup["variant"]): string {
  return [
    v.storageGb !== null ? (v.storageGb >= 1024 && v.storageGb % 1024 === 0 ? `${v.storageGb / 1024} TB` : `${v.storageGb} GB`) : null,
    v.ramGb !== null ? `${v.ramGb} GB RAM` : null,
    v.gpu,
    v.color,
    v.condition === "refurbished" ? "Refurbished" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Full read-only view of one saved group: header, specs, why, verdict, decision, offers. */
export function SavedGroupView({ g, headingLevel = 2 }: { g: SavedGroup; headingLevel?: 1 | 2 | 3 }) {
  const H = headingLevel === 1 ? "h1" : headingLevel === 2 ? "h2" : "h3";
  const verdict = toVerdict(g);
  const d = g.decision;
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <ProductImage src={g.imageUrl ?? undefined} alt={g.name} className="aspect-square h-20 w-20 shrink-0 sm:h-28 sm:w-28" />
        <div className="min-w-0 space-y-1">
          <H className="font-display text-xl font-extrabold leading-snug tracking-tight">{g.name}</H>
          {variantLabel(g.variant) && <p className="text-sm text-muted">{variantLabel(g.variant)}</p>}
          {g.lowestVerified ? (
            <p className="text-sm">Verified lowest price when saved <span className="tabular font-bold">{rupees(g.lowestVerified.price)}</span> at {g.lowestVerified.retailer}</p>
          ) : (
            <p className="text-sm text-muted">Price was not verified when saved</p>
          )}
          {g.provisional && <Badge tone="warn" className="border-fg/30 bg-sun text-fg">PROVISIONAL</Badge>}
        </div>
      </div>

      <section aria-label="Verified specs" className="space-y-2">
        <p className="eyebrow">Verified specs</p>
        <SavedSpecs g={g} />
      </section>

      {g.why.length > 0 && (
        <section aria-label="Why recommended">
          <p className="eyebrow">Why recommended</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{g.why.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </section>
      )}

      {verdict && <TrueCostVerdictPanel verdict={verdict} />}

      <section aria-label="Decision when saved" className="space-y-2">
        <p className="eyebrow">Decision (when saved)</p>
        {d.singleStoreOnly && <p className="rounded-xl border border-fg/30 bg-sun px-3 py-2 text-sm font-medium text-fg">Only one verified store offer was found.</p>}
        <ul className="grid gap-2 sm:grid-cols-2">
          <PickTile title="Cheapest listed" pick={d.cheapestListed} kind="price" />
          <PickTile title="Cheapest payable" pick={d.cheapestPayable} kind="price" />
          <PickTile title="Fastest" pick={d.fastest} kind="eta" />
          <PickTile title="Best overall" pick={d.bestOverall} kind="best" />
        </ul>
        {d.notes.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted">{d.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      </section>

      <section aria-label="Store offers when saved" className="space-y-2">
        <p className="eyebrow">Store offers when saved ({g.offers.length})</p>
        {g.offers.length === 0 ? (
          <p className="text-sm text-muted">No verified offers were saved for this product.</p>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {g.offers.map((o, i) => <SavedOfferCard key={`${o.retailer}-${i}`} offer={o} />)}
          </div>
        )}
      </section>

      {g.evidenceUrls.length > 0 && (
        <details className="rounded-xl border border-line bg-surface2 text-xs">
          <summary className="eyebrow flex min-h-11 cursor-pointer list-none items-center px-3 text-primary">Evidence links ({g.evidenceUrls.length})</summary>
          <ul className="space-y-1 border-t border-line px-3 py-2">
            {g.evidenceUrls.map((u) => (
              <li key={u}><a href={u} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline">{u}</a></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

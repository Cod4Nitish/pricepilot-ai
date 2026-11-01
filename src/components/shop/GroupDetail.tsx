"use client";
import { Loader2, Truck } from "lucide-react";
import type { ProductGroup, ShopResponse, ShopWeights } from "@/lib/shop/types";
import { isVerifiedOffer, offerKey, sortOffers, type ShopSort } from "@/lib/shop-client";
import { Button } from "@/components/ui/button";
import DecisionPanel, { coverageLimited } from "./DecisionPanel";
import RetailerOfferCard from "./RetailerOfferCard";
import { TrueCostVerdictPanel } from "./TrueCostBreakdown";

export interface DeliveryUi {
  loading: Set<string>;
  error: string | null;
}

export default function GroupDetail({
  group,
  pin,
  sort,
  weights,
  weightsPending,
  onApplyWeights,
  delivery,
  onCheckDelivery,
  onNeedPin,
}: {
  group: ProductGroup;
  pin: string | null;
  sort: ShopSort;
  weights: ShopWeights;
  weightsPending: boolean;
  onApplyWeights: (w: ShopWeights) => void;
  delivery: DeliveryUi;
  onCheckDelivery: (offerKeys?: string[]) => void;
  onNeedPin: () => void;
}) {
  const all = sortOffers(group.offers, sort);
  const offers = all.filter((o) => isVerifiedOffer(o) && o.listedPrice !== null);
  const leads = all.filter((o) => !(isVerifiedOffer(o) && o.listedPrice !== null));
  const limited = coverageLimited(group);
  const tagsFor = (key: string, retailer: string) => {
    const d = group.decision;
    const t: string[] = [];
    const is = (p: { offerId: string; retailer: string } | null) => !!p && (p.offerId === key || (p.offerId === "" && p.retailer === retailer));
    if (is(d.cheapestListed)) t.push("Cheapest listed");
    if (is(d.cheapestPayable)) t.push("Cheapest payable");
    if (is(d.fastest)) t.push("Fastest");
    if (!limited && is(d.bestOverall)) t.push("Best overall");
    return t;
  };
  const anyLoading = delivery.loading.size > 0;

  return (
    <div id={`detail-${group.id}`} className="space-y-4" tabIndex={-1}>
      <h3 className="font-display text-xl font-extrabold tracking-tight">Prices for {group.name}</h3>
      {group.trueCostVerdict && <TrueCostVerdictPanel verdict={group.trueCostVerdict} />}
      <DecisionPanel group={group} weights={weights} pending={weightsPending} onApplyWeights={onApplyWeights} />

      <section aria-labelledby={`off-${group.id}`} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`off-${group.id}`} className="font-display text-lg font-bold tracking-tight">{limited ? "Verified store offers" : "Verified price comparison"} ({offers.length})</h3>
          <Button variant="secondary" size="sm" onClick={() => (pin ? onCheckDelivery() : onNeedPin())} disabled={anyLoading || offers.length === 0}>
            {anyLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Truck className="h-4 w-4" aria-hidden />}
            Check delivery{offers.length > 6 ? " (top 6)" : ""}
          </Button>
        </div>
        {delivery.error && <p role="alert" className="rounded-xl border border-bad/40 bg-peach px-3 py-2 text-sm text-fg">{delivery.error}</p>}
        {sort === "delivery" && <p className="text-xs text-muted">Sorted by published delivery estimate. Offers with unknown delivery are listed last.</p>}
        {offers.length === 0 ? (
          <p className="text-sm text-muted">No price-verified offers for this product yet.</p>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {offers.map((o) => (
              <RetailerOfferCard
                key={offerKey(o)}
                offer={o}
                pin={pin}
                tags={tagsFor(offerKey(o), o.retailer)}
                deliveryLoading={delivery.loading.has(offerKey(o))}
                onCheckDelivery={() => (pin ? onCheckDelivery([offerKey(o)]) : onNeedPin())}
              />
            ))}
          </div>
        )}
      </section>

      {leads.length > 0 && (
        <details className="rounded-xl border border-line bg-surface2">
          <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-semibold">
            Unverified leads ({leads.length}) <span className="ml-1 font-normal text-muted">price not verified, not part of the comparison</span>
          </summary>
          <div className="grid gap-3 border-t border-line p-3 xl:grid-cols-2">
            {leads.map((o) => (
              <RetailerOfferCard
                key={offerKey(o)}
                offer={o}
                pin={pin}
                tags={[]}
                deliveryLoading={delivery.loading.has(offerKey(o))}
                onCheckDelivery={() => (pin ? onCheckDelivery([offerKey(o)]) : onNeedPin())}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

export function ComparisonTable({ comparison }: { comparison: NonNullable<ShopResponse["comparison"]> }) {
  return (
    <section aria-labelledby="cmp-h" className="space-y-2">
      <h2 id="cmp-h" className="font-display text-xl font-extrabold tracking-tight">Side-by-side</h2>
      <div className="overflow-x-auto rounded-[1.1rem] border border-line bg-surface">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <caption className="sr-only">Comparison of {comparison.sides.join(" and ")}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="eyebrow p-3">Spec</th>
              {comparison.sides.map((s) => <th key={s} scope="col" className="p-3 font-display font-bold">{s}</th>)}
            </tr>
          </thead>
          <tbody>
            {comparison.table.map((r) => (
              <tr key={r.key} className="border-b border-line last:border-0">
                <th scope="row" className="p-3 text-xs font-semibold text-muted">{r.label}</th>
                {r.values.map((v, i) => (
                  <td key={i} className="p-3">{v === null ? <span className="text-muted">Not found</span> : String(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

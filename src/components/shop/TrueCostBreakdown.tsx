"use client";
import type { TrueCost, TrueCostVerdict } from "@/lib/engine/ecommerce/truecost";
import { cn } from "@/lib/utils";

/** "₹44,999". null never becomes 0. */
export function inr(n: number | null | undefined): string {
  return n === null || n === undefined || Number.isNaN(n) ? "Unknown" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export const COST_STATUS: Record<TrueCost["costStatus"], { label: string; className: string; hint: string }> = {
  CONFIRMED: { label: "Confirmed", className: "border-fg/30 bg-mint text-fg", hint: "Every required charge is known." },
  LOWER_BOUND: { label: "Minimum only", className: "border-fg/30 bg-sun text-fg", hint: "Some charges were not shown; the real total may be higher." },
  CONDITIONAL: { label: "Conditional", className: "border-fg/30 bg-lilac text-fg", hint: "Total is known; extra offers need an eligibility check." },
  UNKNOWN: { label: "Unknown", className: "border-line-strong bg-surface2 text-muted", hint: "The listed price could not be verified." },
};

export function CostStatusChip({ status }: { status: TrueCost["costStatus"] }) {
  const s = COST_STATUS[status];
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-none", s.className)}>
      <span className="sr-only">Cost status: </span>
      {s.label}
    </span>
  );
}

function fee(label: string, v: number | null) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular font-medium">{v === null ? <span className="text-muted">not shown</span> : v === 0 ? "Free (₹0)" : `+ ${inr(v)}`}</dd>
    </div>
  );
}

/** Expandable "what you will actually pay" breakdown for one offer. Pure presentation of the server TrueCost. */
export default function TrueCostBreakdown({ tc, commerceMode = "ecommerce" }: { tc: TrueCost; commerceMode?: string }) {
  const quick = commerceMode !== "ecommerce";
  const headline =
    tc.confirmedTotal !== null ? `Payable total ${inr(tc.confirmedTotal)}` : tc.knownLowerBound !== null ? `At least ${inr(tc.knownLowerBound)}` : "Total unknown";
  return (
    <details className="group rounded-xl border border-line bg-surface2 text-sm">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2">
        <span className="flex min-w-0 flex-col">
          <span className="eyebrow">True cost</span>
          <span className="tabular font-semibold">{headline}</span>
        </span>
        <span className="flex items-center gap-2">
          <CostStatusChip status={tc.costStatus} />
          <span className="text-xs font-semibold text-primary underline-offset-2 group-open:hidden">Show breakdown</span>
          <span className="hidden text-xs font-semibold text-primary group-open:inline">Hide</span>
        </span>
      </summary>
      <div className="space-y-3 border-t border-line px-3 py-3">
        <dl className="space-y-1">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Listed price</dt>
            <dd className="tabular font-semibold">{tc.listedPrice === null ? <span className="text-muted">Not verified</span> : inr(tc.listedPrice)}</dd>
          </div>
          {fee(quick ? "Delivery fee" : "Shipping", tc.knownShippingFee)}
          {(quick || tc.knownHandlingFee !== null) && fee("Handling fee", tc.knownHandlingFee)}
          {(quick || tc.knownPlatformFee !== null) && fee("Platform fee", tc.knownPlatformFee)}
          {tc.confirmedDiscounts.map((d, i) => (
            <div key={i} className="flex justify-between gap-3">
              <dt className="min-w-0 break-words text-muted">{d.text}</dt>
              <dd className="tabular font-medium text-good">- {inr(d.amount)}</dd>
            </div>
          ))}
        </dl>

        <div className="border-t border-dashed border-line-strong pt-2">
          {tc.confirmedTotal !== null ? (
            <p className="flex justify-between gap-3 font-semibold">
              <span>Payable total</span>
              <span className="tabular">{inr(tc.confirmedTotal)}</span>
            </p>
          ) : tc.knownLowerBound !== null ? (
            <>
              <p className="flex justify-between gap-3 font-semibold">
                <span>At least</span>
                <span className="tabular">{inr(tc.knownLowerBound)}</span>
              </p>
              {tc.unknownComponents.length > 0 && (
                <p className="mt-0.5 text-xs text-muted">Not shown by the retailer: {tc.unknownComponents.join(", ")}. The final total may be higher.</p>
              )}
            </>
          ) : (
            <p className="font-semibold">
              Total unknown
              {tc.unknownComponents.length > 0 && <span className="block text-xs font-normal text-muted">Missing: {tc.unknownComponents.join(", ")}.</span>}
            </p>
          )}
          {tc.conditionalBestCase !== null && (
            <p className="mt-1 text-xs">
              Could be <span className="tabular font-semibold">{inr(tc.conditionalBestCase)}</span> if eligible (not guaranteed).
            </p>
          )}
        </div>

        {tc.conditionalDiscounts.length > 0 && (
          <div>
            <p className="text-xs font-semibold">Offers: needs eligibility check, not deducted</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted">
              {tc.conditionalDiscounts.map((d, i) => (
                <li key={i} className="break-words">
                  &ldquo;{d.text}&rdquo;
                  {d.condition && <span> (requires: {d.condition})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {tc.purchasable === "out_of_stock" && <p className="text-xs font-semibold text-bad">Shown as out of stock when checked.</p>}
        <p className="text-xs text-muted">{tc.explanation}</p>
      </div>
    </details>
  );
}

/** Verdict labels for one product group. "Cheapest Confirmed" is shown ONLY when the server awarded it. */
export function TrueCostVerdictPanel({ verdict }: { verdict: TrueCostVerdict }) {
  const c = verdict.cheapestConfirmed;
  return (
    <section aria-label="True cost verdict" className="space-y-2 rounded-[1.1rem] border border-line bg-surface p-3">
      <p className="eyebrow">True cost verdict</p>
      {c ? (
        <div className="rounded-xl border border-fg/30 bg-mint px-3 py-2 text-fg">
          <p className="text-xs font-semibold uppercase tracking-wide">Cheapest Confirmed</p>
          <p className="font-display text-lg font-bold">
            {c.retailer} <span className="tabular">{inr(c.value)}</span>
          </p>
          <p className="text-xs">Lowest fully known payable total among verified exact matches.</p>
        </div>
      ) : (
        <p className="rounded-xl border border-fg/30 bg-sun px-3 py-2 text-sm font-medium text-fg">
          No confirmed winner: no offer has a fully known payable total.
        </p>
      )}
      <dl className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-line p-2">
          <dt className="text-xs font-semibold text-muted">Lowest Listed Price</dt>
          <dd className="text-sm font-semibold">
            {verdict.lowestListed ? (
              <>
                {verdict.lowestListed.retailer} <span className="tabular">{inr(verdict.lowestListed.value)}</span>
                {verdict.tiedLowestListed.length > 1 && <span className="block text-xs font-normal text-muted">Tied across {verdict.tiedLowestListed.length} offers</span>}
              </>
            ) : (
              <span className="text-muted">Not verified</span>
            )}
          </dd>
        </div>
        <div className="rounded-xl border border-line p-2">
          <dt className="text-xs font-semibold text-muted">Lowest Known Minimum</dt>
          <dd className="text-sm font-semibold">
            {verdict.lowestKnownMinimum ? (
              <>
                {verdict.lowestKnownMinimum.retailer} <span className="tabular">{inr(verdict.lowestKnownMinimum.value)}</span>
                <span className="block text-xs font-normal text-muted">Listed + known fees; may rise if unknown charges apply</span>
              </>
            ) : (
              <span className="text-muted">Not verified</span>
            )}
          </dd>
        </div>
      </dl>
      {verdict.notes.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
          {verdict.notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
    </section>
  );
}

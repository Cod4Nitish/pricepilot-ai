"use client";
import { useEffect, useMemo, useState } from "react";
import { Copy, Download, ExternalLink, Share2 } from "lucide-react";
import type { ProductGroup, ShopResponse } from "@/lib/shop/types";
import { buildReceipt, receiptText } from "@/lib/receipts/build";
import { relativeTime } from "@/lib/shop-client";
import { Button } from "@/components/ui/button";
import { COST_STATUS, inr } from "./TrueCostBreakdown";

const VERIF: Record<string, string> = { verified: "Verified", agent_verified: "Agent verified", snippet_only: "Snippet only", unverified: "Unverified" };
const QUALITY: Record<string, string> = { strong: "Strong", partial: "Partial", weak: "Weak", none: "None" };

function Label({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[0.68rem] uppercase tracking-[0.14em] text-muted">{children}</p>;
}
const Divider = () => <hr className="border-0 border-t border-dashed border-line-strong" />;

/** Receipt built client-side from the completed comparison. No server calls. */
export default function DealReceipt({ group, data }: { group: ProductGroup; data: ShopResponse }) {
  const receipt = useMemo(
    () => buildReceipt({ group, parsed: data.parsed, statuses: data.statuses, usage: data.usage ?? null, comparisonGeneratedAt: data.generatedAt }),
    [group, data],
  );
  const [msg, setMsg] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(receiptText(receipt));
      setMsg("Summary copied to clipboard.");
    } catch {
      setMsg("Copy failed: clipboard access was blocked by the browser.");
    }
  }
  function download() {
    const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${receipt.receiptId}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg("Receipt JSON downloaded.");
  }
  async function share() {
    try {
      await navigator.share({ title: `PricePilot receipt: ${receipt.productName}`, text: receiptText(receipt) });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setMsg("Share failed.");
    }
  }

  const rc = receipt.researchCost;
  return (
    <section aria-label="Deal receipt" className="space-y-3 rounded-[1.1rem] border border-line-strong bg-surface p-4 text-fg shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em]">Deal receipt</p>
        <p className="font-mono text-xs text-muted">{receipt.receiptId}</p>
      </div>
      <div>
        <Label>Product</Label>
        <p className="font-display text-lg font-bold">{receipt.productName}</p>
        <p className="text-sm text-muted">Variant: {receipt.productVariant}</p>
        <p className="text-xs text-muted">
          Search &ldquo;{receipt.userQuery}&rdquo; · compared <time dateTime={receipt.comparisonGeneratedAt}>{relativeTime(receipt.comparisonGeneratedAt)}</time>
        </p>
      </div>
      <Divider />
      <div>
        <Label>Retailers ({receipt.verifiedOffers} verified offer{receipt.verifiedOffers === 1 ? "" : "s"})</Label>
        <ul className="mt-1 divide-y divide-dashed divide-line-strong">
          {receipt.lines.map((l, i) => (
            <li key={i} className="space-y-0.5 py-2 text-sm">
              <div className="flex flex-wrap justify-between gap-x-3">
                <span className="font-semibold">{l.retailerName}</span>
                <span className="tabular font-semibold">{l.listedPrice === null ? "Price not verified" : inr(l.listedPrice)}</span>
              </div>
              <p className="text-xs text-muted">
                {VERIF[l.verification] ?? l.verification} · <time dateTime={l.verifiedAt}>{relativeTime(l.verifiedAt)}</time> ·{" "}
                {COST_STATUS[l.costStatus as keyof typeof COST_STATUS]?.label ?? l.costStatus}
              </p>
              <p className="text-xs">
                {l.confirmedTotal !== null
                  ? <>Payable total <span className="tabular font-semibold">{inr(l.confirmedTotal)}</span></>
                  : l.knownMinimum !== null
                    ? <>At least <span className="tabular font-semibold">{inr(l.knownMinimum)}</span>{l.unknownCharges.length > 0 && <span className="text-muted"> ({l.unknownCharges.join(", ")} not shown)</span>}</>
                    : <span className="text-muted">Payable total unknown</span>}
              </p>
              {l.sourceUrl ? (
                <a href={l.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-primary underline">
                  Source page <ExternalLink className="h-3 w-3" aria-hidden /><span className="sr-only">(opens in a new tab)</span>
                </a>
              ) : (
                <p className="text-xs text-muted">Source link removed (failed URL validation)</p>
              )}
            </li>
          ))}
        </ul>
      </div>
      <Divider />
      <div>
        <Label>Verdict</Label>
        {receipt.recommendedOffer && (
          <p className="text-sm font-semibold">
            {receipt.recommendedOffer.label}: <span className="tabular">{inr(receipt.recommendedOffer.value)}</span>
          </p>
        )}
        <p className="text-sm">{receipt.recommendationExplanation}</p>
        {receipt.priceDifference && (
          <p className="text-xs text-muted">Listed-price gap {inr(receipt.priceDifference.amount)}. {receipt.priceDifference.basis}</p>
        )}
      </div>
      <div>
        <Label>Evidence quality</Label>
        <p className="text-sm"><span className="font-semibold">{QUALITY[receipt.evidenceQuality]}</span>: {receipt.evidenceQualityReason}</p>
      </div>
      {receipt.limitations.length > 0 && (
        <div>
          <Label>Limitations</Label>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted">
            {receipt.limitations.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      )}
      <Divider />
      <div>
        <Label>Research cost</Label>
        {rc ? (
          <p className="text-xs">
            {rc.searchRequests} searches · {rc.fetchedUrls} pages fetched · {rc.paidAgentRuns} paid agent runs ({rc.agentSteps} steps) ·{" "}
            {rc.calculatedUsd === null ? "cost unknown (step count not returned)" : `calculated $${rc.calculatedUsd}`}
          </p>
        ) : (
          <p className="text-xs text-muted">Not recorded for this response.</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="secondary" onClick={copy}><Copy className="h-4 w-4" aria-hidden /> Copy summary</Button>
        <Button variant="secondary" onClick={download}><Download className="h-4 w-4" aria-hidden /> Download JSON</Button>
        {canShare && <Button variant="secondary" onClick={share}><Share2 className="h-4 w-4" aria-hidden /> Share</Button>}
      </div>
      <p role="status" aria-live="polite" className="text-xs text-muted">{msg}</p>
    </section>
  );
}

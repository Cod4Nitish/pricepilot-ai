import { BadgeCheck, Bot, FileText, Truck } from "lucide-react";

/**
 * ORIGINAL illustration of what a comparison looks like. Built from plain markup (no data,
 * no logos). All figures are placeholders and the panel is labelled as an example layout.
 */
export default function HeroVisual() {
  return (
    <figure className="relative mx-auto w-full max-w-md" aria-label="Example layout of a price comparison. Not live data.">
      <div aria-hidden className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-primary/20 via-transparent to-accent/20 blur-2xl" />
      <div className="rounded-3xl border border-line-strong bg-surface p-4 shadow-pop">
        <div className="mb-3 flex items-center justify-between">
          <span className="rounded-full border border-warn/50 bg-warn/10 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-warn">Example layout</span>
          <span className="text-xs text-muted">Not live data</span>
        </div>
        <div className="mb-3 flex items-center gap-3 rounded-2xl bg-surface2 p-3">
          <div aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-surface3 text-[10px] font-semibold text-muted">Product</div>
          <div className="min-w-0 flex-1">
            <div aria-hidden className="h-3 w-3/4 rounded bg-surface3" />
            <div aria-hidden className="mt-2 h-3 w-1/2 rounded bg-surface3" />
          </div>
        </div>

        <ul className="space-y-2">
          <li className="relative rounded-2xl border border-good/60 bg-good/5 p-3">
            <span className="absolute -top-2.5 right-3 rounded-full bg-good px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-bg">Best verified</span>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Retailer A</span>
              <span className="tabular font-display text-lg font-bold">₹ XX,XXX</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="inline-flex items-center gap-1 font-semibold text-good"><BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Verified</span>
              <span className="inline-flex items-center gap-1"><Truck className="h-3.5 w-3.5" aria-hidden /> Delivery: Free</span>
            </div>
          </li>
          <li className="rounded-2xl border border-line p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Retailer B</span>
              <span className="tabular font-display text-lg font-bold">₹ XX,XXX</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="inline-flex items-center gap-1 font-semibold text-primary"><Bot className="h-3.5 w-3.5" aria-hidden /> Agent verified</span>
              <span className="inline-flex items-center gap-1"><Truck className="h-3.5 w-3.5" aria-hidden /> Delivery: Unknown</span>
            </div>
          </li>
          <li className="rounded-2xl border border-line p-3 opacity-90">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Retailer C</span>
              <span className="tabular font-display text-lg font-bold">₹ XX,XXX</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className="inline-flex items-center gap-1 font-semibold text-warn"><FileText className="h-3.5 w-3.5" aria-hidden /> Snippet only</span>
              <span>Never ranked as best</span>
            </div>
          </li>
        </ul>

        <p className="mt-3 inline-flex rounded-full border border-good/50 bg-good/10 px-3 py-1.5 text-sm font-semibold text-good">
          You save ₹ X,XXX vs the highest verified price
        </p>
      </div>
    </figure>
  );
}

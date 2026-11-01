import { CheckCircle2, Hourglass, Minus, Scale } from "lucide-react";
import type { PricePoint } from "@/lib/types";
import { cn, formatINR } from "@/lib/utils";
import { deriveAdvice, MIN_POINTS, MIN_SPAN_DAYS } from "./buy-vs-wait";

/** Buy vs Wait. Advice comes strictly from stored price history; otherwise "Not enough history yet". */
export default function BuyVsWait({ points, current }: { points: PricePoint[]; current: number | null }) {
  const a = deriveAdvice(points, current);
  if (a.kind === "insufficient") {
    return (
      <section aria-labelledby="bvw" className="rounded-2xl border border-line bg-surface p-4">
        <h2 id="bvw" className="flex items-center gap-2 font-display font-semibold">
          <Scale className="h-5 w-5 text-muted" aria-hidden /> Buy vs Wait
        </h2>
        <p className="mt-2 font-medium">Not enough history yet</p>
        <p className="mt-1 text-sm text-muted">
          We give advice only from prices we have actually recorded: at least {MIN_POINTS} observations over {MIN_SPAN_DAYS}+ days. This product has {a.points} so far
          {a.spanDays > 0 ? ` over ${a.spanDays.toFixed(1)} days` : ""}. Nothing is estimated.
        </p>
      </section>
    );
  }
  const Icon = a.kind === "buy" ? CheckCircle2 : a.kind === "wait" ? Hourglass : Minus;
  const tone = a.kind === "buy" ? "border-good/60 text-good" : a.kind === "wait" ? "border-warn/60 text-warn" : "border-line-strong text-fg";
  return (
    <section aria-labelledby="bvw" className={cn("rounded-2xl border bg-surface p-4", tone.split(" ")[0])}>
      <h2 id="bvw" className="flex items-center gap-2 font-display font-semibold text-fg">
        <Scale className="h-5 w-5 text-muted" aria-hidden /> Buy vs Wait
      </h2>
      <p className={cn("mt-2 flex items-center gap-2 font-semibold", tone.split(" ")[1])}>
        <Icon className="h-5 w-5" aria-hidden />
        {a.kind === "buy" ? "Buy: " : a.kind === "wait" ? "Wait: " : "Neutral: "}
        {a.headline}
      </p>
      <p className="mt-1 text-sm text-muted">{a.detail}</p>
      <dl className="tabular mt-3 grid grid-cols-3 gap-2 text-sm">
        <div><dt className="text-xs text-muted">Lowest</dt><dd className="font-semibold">{formatINR(a.low)}</dd></div>
        <div><dt className="text-xs text-muted">Median</dt><dd className="font-semibold">{formatINR(a.median)}</dd></div>
        <div><dt className="text-xs text-muted">Highest</dt><dd className="font-semibold">{formatINR(a.high)}</dd></div>
      </dl>
      <p className="mt-2 text-xs text-muted">Based on {a.points} recorded observations over {a.spanDays.toFixed(0)} days. Not a price forecast.</p>
    </section>
  );
}

"use client";
import { ExternalLink, Trophy, Zap, Split } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/utils";
import type { Comparison, StoreBasket } from "@/lib/fast/types";

const toneFor = (k: StoreBasket["totalKind"]) => (k === "verified" ? "good" : k === "estimated" ? "warn" : "bad");

export function StoreColumn({ b, isWinner }: { b: StoreBasket; isWinner: boolean }) {
  const usable = b.state === "ok" || b.state === "partial";
  return (
    <Card className={isWinner ? "border-good/50" : undefined}>
      <div className="flex items-start justify-between gap-2">
        <CardTitle>{b.providerName}</CardTitle>
        {isWinner && <Badge tone="good"><Trophy className="h-3 w-3" aria-hidden /> Cheapest cart</Badge>}
      </div>
      {!usable ? (
        <p className="mt-3 text-sm text-bad" role="status">
          Unavailable: {b.reason || "no data returned"}
        </p>
      ) : (
        <>
          <ul className="mt-3 divide-y divide-line text-sm">
            {b.lines.map((l) => (
              <li key={l.query} className="py-2">
                <div className="flex justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate">{l.offer?.title ?? l.query}</span>
                    <span className="block text-xs text-muted">
                      {l.offer
                        ? `${l.qty} x ${formatINR(l.offer.price)}${l.offer.packLabel ? ` / ${l.offer.packLabel}` : ""}${l.offer.unitPrice ? ` (${formatINR(l.offer.unitPrice.value)}/${l.offer.unitPrice.per})` : ""}`
                        : l.note}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">{l.lineTotal !== null ? formatINR(l.lineTotal) : <Badge tone="bad">{l.resolution.replace("_", " ")}</Badge>}</span>
                </div>
                {l.offer?.evidence && <p className="mt-1 truncate text-xs italic text-muted" title={l.offer.evidence}>Evidence: &ldquo;{l.offer.evidence}&rdquo;</p>}
                {l.offer && (
                  <a className="mt-1 inline-flex items-center gap-1 text-xs text-primary underline" href={l.offer.productUrl ?? b.homeUrl} target="_blank" rel="noopener noreferrer">
                    {l.offer.productUrl ? "Buy on" : "Open"} {b.providerName} <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                )}
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
            <Row k="Items subtotal" v={b.itemsTotal !== null ? formatINR(b.itemsTotal) : "None found"} />
            {(["delivery", "handling", "platform", "discount"] as const).map((k) => (
              <Row key={k} k={`${k[0].toUpperCase()}${k.slice(1)} ${k === "discount" ? "" : "fee"}`.trim()} v={b.fees[k] === null ? "Unknown, not included" : formatINR(b.fees[k])} muted={b.fees[k] === null} />
            ))}
            <Row k="Delivery time (as published)" v={b.etaText ?? "Not published"} muted={!b.etaText} />
          </dl>
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-surface2 p-3">
            <span className="text-sm">
              <span className="block font-semibold tabular-nums">{b.total !== null ? formatINR(b.total) : "-"}</span>
              <Badge tone={toneFor(b.totalKind)}>{b.totalLabel}</Badge>
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

function Row({ k, v, muted }: { k: string; v: string; muted?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted">{k}</dt>
      <dd className={muted ? "text-muted" : "tabular-nums"}>{v}</dd>
    </div>
  );
}

export function ComparisonView({ baskets, comparison }: { baskets: StoreBasket[]; comparison: Comparison }) {
  const w = comparison.winner;
  return (
    <section aria-label="Comparison" className="space-y-4">
      {w ? (
        <Card className="border-good/50">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-good" aria-hidden />
            <CardTitle>Cheapest cart winner: {w.providerName}</CardTitle>
            <Badge tone={w.kind === "verified" ? "good" : "warn"}>{w.kind === "verified" ? "Verified" : "Estimated"}</Badge>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {formatINR(w.total)} <span className="text-sm font-normal text-muted">saves {formatINR(w.savings)} vs {w.vsProviderName}</span>
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">{w.why.map((x) => <li key={x}>{x}</li>)}</ul>
          {w.kind === "estimated" && <p className="mt-2 text-xs text-warn">Estimated (excludes unknown fees). Fees not visible on the pages are not guessed.</p>}
        </Card>
      ) : (
        <Card>
          <CardTitle>No cheapest-cart winner</CardTitle>
          <p className="mt-2 text-sm text-muted">{comparison.noWinnerReason ?? "Not enough verified data."}</p>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {baskets.map((b) => <StoreColumn key={b.providerId} b={b} isWinner={w?.providerId === b.providerId} />)}
      </div>
      <Card>
        <div className="flex items-center gap-2"><Zap className="h-4 w-4 text-primary" aria-hidden /><CardTitle>Fastest</CardTitle></div>
        <p className="mt-2 text-sm text-muted">
          {comparison.fastest ? `${comparison.fastest.providerName}: ${comparison.fastest.etaText} (as published by the store).` : comparison.fastestNote}
        </p>
      </Card>
      {comparison.split && (
        <Card>
          <div className="flex items-center gap-2"><Split className="h-4 w-4 text-primary" aria-hidden /><CardTitle>Split-basket {comparison.split.recommended ? "recommendation" : "check"}</CardTitle></div>
          <p className="mt-2 text-sm text-muted">{comparison.split.reason}</p>
          {comparison.split.recommended && (
            <ul className="mt-2 space-y-1 text-sm">
              {comparison.split.assignments.map((a) => (
                <li key={a.query} className="flex justify-between"><span>{a.query} on {a.providerName}</span><span className="tabular-nums">{formatINR(a.lineTotal)}</span></li>
              ))}
              <li className="flex justify-between font-semibold"><span>Split total ({comparison.split.totalKind})</span><span>{formatINR(comparison.split.total)}</span></li>
            </ul>
          )}
        </Card>
      )}
      <Card>
        <CardTitle>Best overall</CardTitle>
        <p className="mt-2 text-sm font-medium">{comparison.bestOverall.text}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">{comparison.bestOverall.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        <p className="mt-3 text-xs text-muted">Links open the retailer&apos;s own site. PricePilot never places orders or automates checkout.</p>
      </Card>
    </section>
  );
}

"use client";
import { useId, useState } from "react";
import type { Pick, ProductGroup, ShopWeights } from "@/lib/shop/types";
import { normalizeWeights, rupees } from "@/lib/shop-client";
import { Button } from "@/components/ui/button";

export const SINGLE_STORE_NOTE = "Multi-store comparison is not possible yet: only one verified store offer was found.";

function pickValue(p: Pick, kind: string): string {
  if (p.value === null) return "";
  if (typeof p.value === "number") return kind === "best" ? `Score ${Math.round(p.value)}` : rupees(p.value);
  return p.value;
}

function Tile({ title, pick, kind, reason }: { title: string; pick: Pick | null; kind: string; reason: string | null }) {
  return (
    <li className="lift-3d rounded-[1.1rem] border border-line bg-surface p-3">
      <p className="eyebrow">{title}</p>
      {pick ? (
        <>
          <p className="mt-1 font-display text-lg font-bold">{pick.retailer}</p>
          {pick.value !== null && <p className="tabular text-sm font-semibold">{pickValue(pick, kind)}</p>}
          <details className="mt-1 text-xs">
            <summary className="flex min-h-11 cursor-pointer list-none items-center font-semibold text-primary">Reasons, conditions, evidence</summary>
            <div className="space-y-2 text-muted">
              {pick.reasons.length > 0 && (
                <ul className="list-disc pl-4">{pick.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              )}
              {pick.conditions.length > 0 && (
                <div>
                  <p className="font-semibold text-fg">Conditions</p>
                  <ul className="list-disc pl-4">{pick.conditions.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
              )}
              {pick.evidence.length > 0 && (
                <div>
                  <p className="font-semibold text-fg">Evidence</p>
                  <ul className="list-disc break-words pl-4">{pick.evidence.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
              )}
            </div>
          </details>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm font-medium text-muted">Not enough verified data</p>
          {reason && <p className="mt-0.5 text-xs text-muted">{reason}</p>}
        </>
      )}
    </li>
  );
}

function Slider({ label, value, onChange, pct }: { label: string; value: number; onChange: (n: number) => void; pct: number }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="flex justify-between text-xs font-medium">
        <span>{label}</span>
        <span className="tabular text-muted">{pct}%</span>
      </label>
      <input id={id} type="range" min={0} max={100} step={5} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-11 w-full cursor-pointer accent-primary" />
    </div>
  );
}

export default function DecisionPanel({
  group,
  weights,
  pending,
  onApplyWeights,
}: {
  group: ProductGroup;
  weights: ShopWeights;
  pending: boolean;
  onApplyWeights: (w: ShopWeights) => void;
}) {
  const d = group.decision;
  const [w, setW] = useState({ price: Math.round(weights.price * 100), delivery: Math.round(weights.delivery * 100), evidence: Math.round(weights.evidence * 100) });
  const n = normalizeWeights(w);
  const pct = (x: number) => Math.round(x * 100);
  const reasonFor = (k: string) => d.notes.find((x) => x.toLowerCase().includes(k)) ?? d.notes[0] ?? null;

  return (
    <section aria-labelledby={`dp-${group.id}`} className="space-y-3">
      <h3 id={`dp-${group.id}`} className="font-display text-lg font-bold tracking-tight">Decision</h3>
      {d.singleStoreOnly && (
        <p role="note" className="rounded-xl border border-fg/30 bg-sun px-3 py-2 text-sm font-medium text-fg">{SINGLE_STORE_NOTE}</p>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        <Tile title="Cheapest listed" pick={d.cheapestListed} kind="price" reason={reasonFor("listed") ?? reasonFor("cheap")} />
        <Tile title="Cheapest payable" pick={d.cheapestPayable} kind="price" reason={reasonFor("payable") ?? reasonFor("fee")} />
        <Tile title="Fastest" pick={d.fastest} kind="eta" reason={reasonFor("deliver") ?? reasonFor("fast")} />
        <Tile title="Best overall" pick={d.bestOverall} kind="best" reason={reasonFor("best") ?? reasonFor("overall")} />
      </ul>

      {d.notes.length > 0 && (
        <div>
          <p className="eyebrow">Why not others</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted">{d.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}

      <details className="rounded-xl border border-line bg-surface2">
        <summary className="eyebrow flex min-h-11 cursor-pointer list-none items-center px-3">Best-overall weights</summary>
        <form
          className="space-y-1 border-t border-line px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            onApplyWeights(n);
          }}
        >
          <Slider label="Price" value={w.price} pct={pct(n.price)} onChange={(v) => setW({ ...w, price: v })} />
          <Slider label="Delivery" value={w.delivery} pct={pct(n.delivery)} onChange={(v) => setW({ ...w, delivery: v })} />
          <Slider label="Evidence quality" value={w.evidence} pct={pct(n.evidence)} onChange={(v) => setW({ ...w, evidence: v })} />
          <p className="text-xs text-muted">Weights are normalised to 100%. The server recomputes the ranking.</p>
          <Button type="submit" size="sm" disabled={pending}>{pending ? "Applying..." : "Apply weights"}</Button>
        </form>
      </details>
    </section>
  );
}

"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Minus, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { useBasketLines } from "@/lib/basket-store";
import { formatINR } from "@/lib/utils";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import ErrorCard from "@/components/product/ErrorCard";
import { ResultsSkeleton } from "@/components/product/Skeletons";
import VerificationBadge from "@/components/product/VerificationBadge";

export default function BasketPage() {
  const { lines, ready, add, setQty, remove, clear } = useBasketLines();
  const [text, setText] = useState("");
  const plan = useMutation({ mutationFn: () => api.basket(lines) });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-h1 font-bold">Smart Basket</h1>
        <p className="text-sm text-muted">Add several products. We find the cheapest verified combination across stores, including delivery where known.</p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add(text);
          setText("");
        }}
      >
        <label htmlFor="basket-add" className="sr-only">Product to add</label>
        <Input id="basket-add" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a product, e.g. boAt Airdopes 141" />
        <Button type="submit" disabled={!text.trim()}>
          <Plus className="h-4 w-4" aria-hidden /> Add
        </Button>
      </form>

      {ready && lines.length === 0 && (
        <Card><p className="text-sm text-muted">Your basket is empty. Add at least one product above.</p></Card>
      )}

      {lines.length > 0 && (
        <Card className="p-0 sm:p-0">
          <ul className="divide-y divide-line">
            {lines.map((l, i) => (
              <li key={`${l.query}-${i}`} className="flex flex-wrap items-center gap-3 p-4">
                <span className="min-w-0 flex-1 truncate font-medium">{l.query}</span>
                <div className="flex items-center gap-1" role="group" aria-label={`Quantity for ${l.query}`}>
                  <Button size="icon" variant="secondary" aria-label="Decrease quantity" onClick={() => setQty(i, l.qty - 1)} disabled={l.qty <= 1}>
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="w-8 text-center tabular-nums" aria-live="polite">{l.qty}</span>
                  <Button size="icon" variant="secondary" aria-label="Increase quantity" onClick={() => setQty(i, l.qty + 1)}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <Button size="icon" variant="ghost" aria-label={`Remove ${l.query}`} onClick={() => remove(i)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 border-t border-line p-4">
            <Button onClick={() => plan.mutate()} disabled={plan.isPending}>
              {plan.isPending ? "Planning…" : "Find cheapest plan"}
            </Button>
            <Button variant="ghost" onClick={clear}>Clear basket</Button>
          </div>
        </Card>
      )}

      {plan.isPending && <ResultsSkeleton note="Checking retailers for every item. This can take a while." />}
      {plan.isError && <ErrorCard error={plan.error} onRetry={() => plan.mutate()} />}

      {plan.data && (
        <section className="space-y-4" aria-label="Basket plan">
          <Card className="border-primary/40 bg-gradient-to-br from-primary/10 to-accent/10">
            <p className="text-sm text-muted">Total (verified items only)</p>
            <p className="font-display text-3xl font-bold">{plan.data.totalVerified === null ? "Unknown" : formatINR(plan.data.totalVerified)}</p>
            {plan.data.totalVerified === null && <p className="text-xs text-muted">A total could not be computed, often because delivery charges are unknown.</p>}
          </Card>

          {plan.data.stores.length === 0 && <Card><p className="text-sm text-muted">No store could supply any verified item.</p></Card>}
          {plan.data.stores.map((s) => (
            <Card key={s.retailer}>
              <div className="flex items-center justify-between">
                <CardTitle>{s.retailerName}</CardTitle>
                <Badge tone="brand">{formatINR(s.total)}</Badge>
              </div>
              <ul className="mt-3 space-y-2">
                {s.lines.map((ln, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <a href={ln.offer.url} target="_blank" rel="noopener noreferrer" className="line-clamp-1 font-medium hover:text-primary">{ln.offer.title}</a>
                      <p className="text-xs text-muted">{ln.query} · {formatINR(ln.offer.price)} × {ln.qty}</p>
                    </div>
                    <VerificationBadge value={ln.offer.verification} />
                  </li>
                ))}
              </ul>
              <dl className="mt-3 grid grid-cols-2 gap-1 border-t border-line pt-3 text-sm">
                <dt className="text-muted">Subtotal</dt><dd className="text-right">{formatINR(s.subtotal)}</dd>
                <dt className="text-muted">Delivery</dt><dd className="text-right">{s.delivery === null ? "Unknown" : s.delivery === 0 ? "Free" : formatINR(s.delivery)}</dd>
                <dt className="font-semibold">Total</dt><dd className="text-right font-semibold">{s.total === null ? "Unknown (delivery unknown)" : formatINR(s.total)}</dd>
              </dl>
              {s.freeShippingNote && <p className="mt-2 text-xs text-muted">{s.freeShippingNote}</p>}
            </Card>
          ))}

          {plan.data.unresolved.length > 0 && (
            <Card className="border-warn/40">
              <CardTitle>Could not find a verified offer</CardTitle>
              <ul className="mt-2 list-disc pl-5 text-sm text-muted">{plan.data.unresolved.map((u) => <li key={u}>{u}</li>)}</ul>
            </Card>
          )}
          {plan.data.caveats.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted">{plan.data.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
          )}
        </section>
      )}
    </div>
  );
}

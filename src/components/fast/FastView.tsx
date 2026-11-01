"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Swords } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LocationSelector } from "@/components/ui/location-selector";
import { cn } from "@/lib/utils";
import type { BasketLine, FastBasketResponse } from "@/lib/fast/types";
import { ComparisonView } from "./ComparisonView";
import { ItemsEditor, linesFromParams } from "./ItemsEditor";
import { ProviderNotes, SetupCard } from "./SetupCard";

type St =
  | { k: "idle" }
  | { k: "loading" }
  | { k: "ok"; data: FastBasketResponse }
  | { k: "not_configured" }
  | { k: "error"; message: string };

export function battleHref(lines: BasketLine[]): string {
  const sp = new URLSearchParams();
  for (const l of lines) sp.append("i", `${l.query}~${l.qty}`);
  return `/battle?${sp}`;
}

export function FastView() {
  const sp = useSearchParams();
  const [pincode, setPincode] = useState<string | null>(null);
  const [items, setItems] = useState<BasketLine[]>(() => linesFromParams(new URLSearchParams(sp.toString())));
  const [st, setSt] = useState<St>({ k: "idle" });
  const [providers, setProviders] = useState<{ id: string; name: string; status: string; reason: string }[]>([]);

  useEffect(() => {
    fetch("/api/fast/status").then((r) => r.json()).then((j) => setProviders(j.providers ?? [])).catch(() => undefined);
  }, []);

  async function run() {
    if (!pincode || items.length === 0) return;
    setSt({ k: "loading" });
    try {
      const res = await fetch("/api/fast/basket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pincode, items }) });
      const j = await res.json();
      if (res.ok) return setSt({ k: "ok", data: j });
      if (j?.error?.code === "NOT_CONFIGURED") return setSt({ k: "not_configured" });
      setSt({ k: "error", message: j?.error?.message ?? `Request failed (${res.status})` });
    } catch {
      setSt({ k: "error", message: "Network error. Check your connection and try again." });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Smart grocery cart</h1>
        <p className="mt-1 text-sm text-muted">Compare Blinkit and Zepto at your pincode, for exact pack sizes. Fees that are not visible on the store pages are shown as unknown, never guessed.</p>
      </header>
      <Card className="space-y-4">
        <LocationSelector onChange={setPincode} />
        <ItemsEditor items={items} onChange={setItems} disabled={st.k === "loading"} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={run} disabled={!pincode || items.length === 0 || st.k === "loading"}>
            {st.k === "loading" ? "Checking stores (up to a few minutes)" : "Compare carts"}
          </Button>
          {items.length > 0 && (
            <Link href={battleHref(items)} className={cn(buttonVariants({ variant: "secondary" }))}>
              <Swords className="h-4 w-4" aria-hidden /> Watch live Deal Battle
            </Link>
          )}
        </div>
        {!pincode && <p className="text-xs text-muted">Save a pincode above to start.</p>}
      </Card>
      <div aria-live="polite">
        {st.k === "loading" && (
          <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
        )}
        {st.k === "not_configured" && <SetupCard />}
        {st.k === "error" && (
          <Card role="alert" className="border-bad/40"><CardTitle>Could not compare</CardTitle><p className="mt-2 text-sm text-muted">{st.message}</p></Card>
        )}
        {st.k === "ok" && (
          <>
            <p className="mb-3 text-xs text-muted">Checked at pincode {st.data.pincode} {st.data.cached ? "(from the 10-minute cache)" : ""}</p>
            <ComparisonView baskets={st.data.baskets} comparison={st.data.comparison} />
          </>
        )}
      </div>
      {providers.length > 0 && <ProviderNotes providers={providers} />}
    </div>
  );
}

"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, LineChart, SearchX } from "lucide-react";
import type { Offer, SearchResponse } from "@/lib/types";
import { api, loadLastSearch } from "@/lib/api-client";
import ProductCard from "@/components/product/ProductCard";
import RetailerPriceCard from "@/components/product/RetailerPriceCard";
import SpecComparison from "@/components/product/SpecComparison";
import PriceHistoryPanel from "@/components/product/PriceHistoryPanel";
import BuyVsWait from "@/components/product/BuyVsWait";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/state";
import { Skeleton } from "@/components/ui/skeleton";

function Detail({ offer, data }: { offer: Offer; data: SearchResponse }) {
  const hist = useQuery({ queryKey: ["history", offer.id, "90"], queryFn: () => api.history(offer.id, 90) });
  const others = data.offers.filter((o) => o.id !== offer.id);
  const compared = [offer, ...others];
  return (
    <div className="space-y-8">
      <Link href={`/search?q=${encodeURIComponent(data.query)}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to results for “{data.query}”
      </Link>

      <h1 className="sr-only">{offer.title}</h1>
      <ProductCard offer={offer} query={data.query} detail={false} best={data.bestVerified?.id === offer.id} />

      <section aria-labelledby="retailers-h">
        <h2 id="retailers-h" className="mb-3 font-display text-h2 font-bold">Prices across retailers</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {compared.map((o) => (
            <RetailerPriceCard key={o.id} offer={o} best={data.bestVerified?.id === o.id} />
          ))}
        </div>
        {others.length === 0 && <p className="mt-3 text-sm text-muted">No other confident matches were found in this search.</p>}
      </section>

      <section aria-labelledby="spec-h">
        <h2 id="spec-h" className="mb-3 font-display text-h2 font-bold">Specifications</h2>
        <SpecComparison offers={compared} />
      </section>

      <section aria-labelledby="hist-h" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="hist-h" className="font-display text-h2 font-bold">Price history (90 days)</h2>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/history?key=${encodeURIComponent(offer.id)}`}>
              <LineChart className="h-4 w-4" aria-hidden /> Open full history
            </Link>
          </Button>
        </div>
        {hist.isPending && <Skeleton className="h-64 w-full" />}
        {hist.isError && <p role="alert" className="text-sm text-muted">Price history could not be loaded right now. It is optional and nothing is estimated in its place.</p>}
        {hist.data && (
          <>
            <BuyVsWait points={hist.data.points} current={offer.price} />
            <PriceHistoryPanel points={hist.data.points} days={90} />
          </>
        )}
      </section>
    </div>
  );
}

export default function ProductPage({ params }: { params: Promise<{ key: string }> }) {
  const { key: rawKey } = use(params);
  const key = decodeURIComponent(rawKey);
  const [state, setState] = useState<{ loaded: boolean; data: SearchResponse | null }>({ loaded: false, data: null });
  useEffect(() => setState({ loaded: true, data: loadLastSearch() }), []);

  if (!state.loaded) return <Skeleton className="h-64 w-full" />;

  const all: Offer[] = state.data ? [...state.data.offers, ...state.data.excluded] : [];
  const offer = all.find((o) => o.id === key);

  if (!state.data || !offer) {
    return (
      <EmptyState
        icon={SearchX}
        title="Product comparison not available"
        action={
          <Button asChild>
            <Link href={state.data ? `/search?q=${encodeURIComponent(state.data.query)}` : "/search"}>Search again</Link>
          </Button>
        }
      >
        This view is built from your most recent search in this browser session, and it is not in memory. Search again to rebuild the comparison.
      </EmptyState>
    );
  }
  return <Detail offer={offer} data={state.data} />;
}

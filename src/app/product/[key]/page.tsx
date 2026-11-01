"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { LineChart, SearchX } from "lucide-react";
import type { Offer, SearchResponse } from "@/lib/types";
import { loadLastSearch } from "@/lib/api-client";
import { formatINR } from "@/lib/utils";
import ProductCard from "@/components/product/ProductCard";
import VerificationBadge from "@/components/product/VerificationBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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
      <Card className="mx-auto max-w-lg text-center">
        <SearchX className="mx-auto mb-3 h-10 w-10 text-muted" aria-hidden />
        <h1 className="font-display text-xl font-bold">Product comparison not available</h1>
        <p className="mt-2 text-sm text-muted">
          This view is built from your most recent search in this browser session, and it is not in memory. Search again to rebuild the comparison.
        </p>
        <Button asChild className="mt-4">
          <Link href={state.data ? `/search?q=${encodeURIComponent(state.data.query)}` : "/search"}>Search again</Link>
        </Button>
      </Card>
    );
  }

  const others = state.data.offers.filter((o) => o.id !== offer.id);
  return (
    <div className="space-y-6">
      <Link href={`/search?q=${encodeURIComponent(state.data.query)}`} className="text-sm text-primary hover:underline">
        ← Back to results for “{state.data.query}”
      </Link>
      <ProductCard offer={offer} query={state.data.query} detail={false} />
      {offer.evidence && (
        <Card>
          <h2 className="font-display font-semibold">Evidence from the page</h2>
          <blockquote className="mt-2 border-l-2 border-primary pl-3 text-sm text-muted">{offer.evidence}</blockquote>
        </Card>
      )}
      <Button asChild variant="secondary">
        <Link href={`/history?key=${encodeURIComponent(offer.id)}`}>
          <LineChart className="h-4 w-4" aria-hidden /> View price history
        </Link>
      </Button>
      <section aria-label="Comparison across retailers">
        <h2 className="mb-3 font-display text-lg font-semibold">Compare with other matches</h2>
        {others.length === 0 ? (
          <p className="text-sm text-muted">No other confident matches were found in this search.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Offers from this search</caption>
              <thead className="bg-surface2 text-xs text-muted">
                <tr>
                  <th scope="col" className="p-3">Retailer</th>
                  <th scope="col" className="p-3">Price</th>
                  <th scope="col" className="p-3">Delivery</th>
                  <th scope="col" className="p-3">Verification</th>
                  <th scope="col" className="p-3"><span className="sr-only">Link</span></th>
                </tr>
              </thead>
              <tbody>
                {others.map((o) => (
                  <tr key={o.id} className="border-t border-line">
                    <th scope="row" className="p-3 font-medium">{o.retailerName}</th>
                    <td className="p-3 font-semibold">{formatINR(o.price)}</td>
                    <td className="p-3 text-muted">{o.deliveryCharge === null ? "Unknown" : o.deliveryCharge === 0 ? "Free" : formatINR(o.deliveryCharge)}</td>
                    <td className="p-3"><VerificationBadge value={o.verification} /></td>
                    <td className="p-3">
                      <a href={o.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Open</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

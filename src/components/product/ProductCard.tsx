"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, Star, Tag, Truck } from "lucide-react";
import type { Offer } from "@/lib/types";
import { api } from "@/lib/api-client";
import { cn, formatINR, timeAgo } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import VerificationBadge from "./VerificationBadge";

export function ProductImage({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={cn("grid place-items-center rounded-xl bg-surface2 text-xs text-muted", className)} role="img" aria-label="No image available">
        No image
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={cn("rounded-xl bg-white object-contain", className)} />;
}

const AVAIL = {
  in_stock: { label: "In stock", tone: "good" },
  out_of_stock: { label: "Out of stock", tone: "bad" },
  unknown: { label: "Availability unknown", tone: "neutral" },
} as const;

export default function ProductCard({ offer, query, detail = true }: { offer: Offer; query?: string; detail?: boolean }) {
  const av = AVAIL[offer.availability];
  const watch = useMutation({
    mutationFn: () =>
      api.addWatch({ productQuery: query ?? offer.title, title: offer.title, imageUrl: offer.imageUrl, lastPrice: offer.price }),
  });
  return (
    <Card className="flex flex-col gap-4 sm:flex-row">
      <ProductImage src={offer.imageUrl} alt={offer.title} className="h-32 w-full shrink-0 sm:h-36 sm:w-36" />
      <div className="min-w-0 flex-1 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">{offer.retailerName}</Badge>
          <VerificationBadge value={offer.verification} />
          <Badge tone={av.tone}>{av.label}</Badge>
        </div>
        <h3 className="line-clamp-2 font-display text-base font-semibold leading-snug">{offer.title}</h3>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-2xl font-bold">{formatINR(offer.price)}</span>
          {offer.mrp !== null && offer.mrp !== offer.price && <span className="text-sm text-muted line-through">{formatINR(offer.mrp)}</span>}
          {offer.discountPct !== null && <span className="text-sm font-semibold text-good">{Math.round(offer.discountPct)}% off</span>}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted">
          <div className="flex items-center gap-1.5">
            <Truck className="h-3.5 w-3.5" aria-hidden />
            <dt className="sr-only">Delivery</dt>
            <dd>
              Delivery: {offer.deliveryCharge === null ? "Unknown" : offer.deliveryCharge === 0 ? "Free" : formatINR(offer.deliveryCharge)}
            </dd>
          </div>
          <div>
            <dt className="inline">Seller: </dt>
            <dd className="inline">{offer.seller ?? "Unknown"}</dd>
          </div>
          <div>
            <dt className="inline">Last checked: </dt>
            <dd className="inline">
              <time dateTime={offer.checkedAt}>{timeAgo(offer.checkedAt)}</time>
            </dd>
          </div>
          <div>
            <dt className="inline">Match: </dt>
            <dd className="inline">{Math.round(offer.matchConfidence * 100)}%</dd>
          </div>
        </dl>
        {offer.offers.length > 0 && (
          <div className="rounded-xl border border-line bg-surface2/60 p-3 text-xs">
            <p className="mb-1 flex items-center gap-1.5 font-semibold">
              <Tag className="h-3.5 w-3.5" aria-hidden /> Offers listed on the page{" "}
              <span className="font-normal text-warn">(conditions not verified)</span>
            </p>
            <ul className="list-disc space-y-0.5 pl-4 text-muted">
              {offer.offers.slice(0, 4).map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          </div>
        )}
        {offer.matchNotes.length > 0 && <p className="text-xs text-muted">{offer.matchNotes.join(" · ")}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button asChild size="sm">
            <a href={offer.url} target="_blank" rel="noopener noreferrer">
              View on {offer.retailerName} <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          </Button>
          {detail && (
            <Button asChild size="sm" variant="secondary">
              <Link href={`/product/${encodeURIComponent(offer.id)}`}>Details</Link>
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => watch.mutate()} disabled={watch.isPending || watch.isSuccess}>
            <Star className="h-4 w-4" aria-hidden /> {watch.isSuccess ? "Tracking" : "Track price"}
          </Button>
        </div>
        <p role="status" className="text-xs">
          {watch.isError && <span className="text-bad">{(watch.error as Error).message}{" "}</span>}
          {watch.isError && /sign in/i.test((watch.error as Error).message) && (
            <Link href="/settings" className="text-primary underline">Go to sign in</Link>
          )}
          {watch.isSuccess && <span className="text-good">Added to your watchlist.</span>}
        </p>
      </div>
    </Card>
  );
}

"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, LogIn, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/lib/use-session";
import type { WatchlistItem } from "@/lib/types";
import { formatINR } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import ErrorCard from "@/components/product/ErrorCard";
import { ProductImage } from "@/components/product/ProductCard";

function WatchRow({ item }: { item: WatchlistItem }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState(item.targetPrice?.toString() ?? "");
  const remove = useMutation({ mutationFn: () => api.removeWatch(item.id), onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }) });
  const alert = useMutation({
    mutationFn: () => api.setAlert({ watchlistId: item.id, targetPrice: Number(target) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });
  const valid = Number(target) > 0;
  return (
    <Card className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <ProductImage src={item.imageUrl} alt={item.title} className="h-20 w-20 shrink-0" />
      <div className="min-w-0 flex-1">
        <Link href={`/search?q=${encodeURIComponent(item.productQuery)}`} className="line-clamp-2 font-medium hover:text-primary">{item.title}</Link>
        <p className="text-sm text-muted">
          Last price: {formatINR(item.lastPrice)} · Target: {item.targetPrice === null ? "not set" : formatINR(item.targetPrice)}
        </p>
        <form
          className="mt-2 flex max-w-xs items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) alert.mutate();
          }}
        >
          <label htmlFor={`t-${item.id}`} className="sr-only">Target price in rupees</label>
          <Input id={`t-${item.id}`} type="number" inputMode="numeric" min={1} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Target ₹" className="h-9" />
          <Button size="sm" variant="secondary" type="submit" disabled={!valid || alert.isPending}>
            <BellRing className="h-4 w-4" aria-hidden /> Set alert
          </Button>
        </form>
        <p role="status" className="mt-1 text-xs">
          {alert.isError && <span className="text-bad">{(alert.error as Error).message}</span>}
          {alert.isSuccess && <span className="text-good">Alert saved.</span>}
        </p>
      </div>
      <Button size="icon" variant="danger" aria-label={`Remove ${item.title}`} onClick={() => remove.mutate()} disabled={remove.isPending}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </Card>
  );
}

export default function WatchlistPage() {
  const { session, loading } = useSession();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const list = useQuery({ queryKey: ["watchlist", session?.user.id], queryFn: api.watchlist, enabled: !!session });
  const add = useMutation({
    mutationFn: (q: string) => api.addWatch({ productQuery: q, title: q }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["watchlist"] });
    },
  });

  if (loading) return <Skeleton className="h-40 w-full" />;
  if (!session) {
    return (
      <Card className="mx-auto max-w-lg text-center">
        <LogIn className="mx-auto mb-3 h-10 w-10 text-primary" aria-hidden />
        <h1 className="font-display text-xl font-bold">Sign in to use your watchlist</h1>
        <p className="mt-2 text-sm text-muted">Watchlists and price alerts are tied to your account so they follow you across devices.</p>
        <Button asChild className="mt-4"><Link href="/settings#account">Go to sign in</Link></Button>
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold">Watchlist</h1>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add.mutate(text.trim());
        }}
      >
        <label htmlFor="watch-add" className="sr-only">Product to watch</label>
        <Input id="watch-add" value={text} onChange={(e) => setText(e.target.value)} placeholder="Product to watch, e.g. Galaxy S24 256GB" />
        <Button type="submit" disabled={!text.trim() || add.isPending}><Plus className="h-4 w-4" aria-hidden /> Watch</Button>
      </form>
      {add.isError && <p role="alert" className="text-sm text-bad">{(add.error as Error).message}</p>}
      {list.isPending && <Skeleton className="h-28 w-full" />}
      {list.isError && <ErrorCard error={list.error} onRetry={() => list.refetch()} />}
      {list.data && list.data.length === 0 && <Card><p className="text-sm text-muted">Nothing tracked yet. Add a product above, or press “Track price” on a search result.</p></Card>}
      {list.data?.map((it) => <WatchRow key={it.id} item={it} />)}
    </div>
  );
}

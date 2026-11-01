"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Compass, ExternalLink, Route, Swords, Zap } from "lucide-react";
import type { Mode, RoutedItem } from "@/lib/intent";
import type { FastBasketResponse, ProviderResult } from "@/lib/fast/types";
import type { Offer, SearchResponse } from "@/lib/types";
import { api, ApiRequestError } from "@/lib/api-client";
import { cn, formatINR } from "@/lib/utils";
import { fastSearch, fetchIntent, MODE_LABEL, type SearchMode } from "@/components/layout/discover-api";
import { LocationSelector } from "@/components/ui/location-selector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/state";
import { Tabs } from "@/components/ui/tabs";
import SearchResults from "@/components/product/SearchResults";
import ErrorCard from "@/components/product/ErrorCard";
import { ResultsSkeleton } from "@/components/product/Skeletons";

const MODES: { value: SearchMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "ecommerce", label: "E-Commerce" },
  { value: "quick", label: "Quick" },
  { value: "both", label: "Both" },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A quick-commerce offer is comparable with an e-commerce title only if its parsed pack label appears in that title. */
function comparable(q: Offer, f: NonNullable<ProviderResult["lines"][number]["offer"]>): boolean {
  if (!f.packLabel || !f.pack) return false;
  return norm(q.title).includes(norm(f.packLabel));
}

function QuickResults({ data }: { data: FastBasketResponse }) {
  return (
    <div className="space-y-3">
      <ul className="space-y-3" aria-label="Quick commerce results">
        {[...data.providers]
          .sort((a, b) => (a.lines[0]?.offer?.price ?? Infinity) - (b.lines[0]?.offer?.price ?? Infinity))
          .map((p) => {
            const line = p.lines[0];
            const o = line?.offer;
            const ok = (p.state === "ok" || p.state === "partial") && o && o.price !== null;
            return (
              <li key={p.providerId} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-display font-semibold">{p.providerName}</h3>
                  <Badge tone={ok ? "good" : p.state === "no_results" ? "neutral" : "warn"}>{ok ? "Price found" : `Unavailable: ${p.state.replace(/_/g, " ")}`}</Badge>
                </div>
                {ok && o ? (
                  <div className="mt-2 space-y-1">
                    <p className="line-clamp-2 text-sm font-medium">{o.title}{o.packLabel ? ` · ${o.packLabel}` : ""}</p>
                    <p className="flex flex-wrap items-baseline gap-x-3">
                      <span className="tabular font-display text-2xl font-bold">{formatINR(o.price)}</span>
                      {o.mrp !== null && o.mrp !== o.price && <span className="text-sm text-muted line-through">{formatINR(o.mrp)}</span>}
                      {o.unitPrice && <span className="text-xs text-muted">{formatINR(o.unitPrice.value)} per {o.unitPrice.per}</span>}
                    </p>
                    <p className="text-xs text-muted">Delivery ETA: <span className="font-medium text-fg">{o.deliveryEta ?? "Unknown"}</span> · Fees not included (unknown until checkout)</p>
                    {o.evidence && (
                      <details className="rounded-xl border border-line bg-surface2 text-xs">
                        <summary className="min-h-10 cursor-pointer list-none px-3 py-2.5 font-semibold text-primary">Show evidence</summary>
                        <blockquote className="border-t border-line px-3 py-2 text-muted">{o.evidence}</blockquote>
                      </details>
                    )}
                    <Button asChild size="sm" variant="secondary" className="mt-1">
                      <a href={o.productUrl ?? p.homeUrl} target="_blank" rel="noopener noreferrer">
                        Open on {p.providerName} <ExternalLink className="h-4 w-4" aria-hidden />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    </Button>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted">{p.reason || line?.note || "No price could be confirmed."}</p>
                )}
              </li>
            );
          })}
      </ul>
      <p className="text-xs text-muted">Pincode {data.pincode} · checked {new Date(data.generatedAt).toLocaleTimeString("en-IN")}{data.cached ? " (cached)" : ""}</p>
    </div>
  );
}

function SourceError({ error, retry, label }: { error: unknown; retry: () => void; label: string }) {
  const e = error instanceof ApiRequestError ? error : null;
  if (e?.notConfigured) {
    return (
      <div role="alert" className="rounded-2xl border border-warn/60 bg-warn/5 p-4 text-sm">
        <p className="font-semibold">{label} is not configured on this server</p>
        <p className="mt-1 text-muted">{e.message.replace(/\.$/, "")}. No sample data is shown instead.</p>
      </div>
    );
  }
  return <ErrorCard error={error} onRetry={retry} />;
}

function Summary({ eco, quick }: { eco: SearchResponse | undefined; quick: FastBasketResponse | undefined }) {
  const e = eco?.bestVerified ?? null;
  const qp = quick?.providers
    .filter((p) => (p.state === "ok" || p.state === "partial") && p.lines[0]?.offer?.price != null)
    .sort((a, b) => (a.lines[0]!.offer!.price as number) - (b.lines[0]!.offer!.price as number))[0];
  const qo = qp?.lines[0]?.offer ?? null;
  if (!eco || !quick) return null;
  if (!e || e.price === null || !qo || qo.price === null || !qp) {
    return (
      <section aria-label="Cross-mode summary" className="rounded-2xl border border-line-strong bg-surface p-4 text-sm">
        <h3 className="font-display font-semibold">Fastest / Cheapest / Best overall</h3>
        <p className="mt-1 text-muted">Not shown: we need a real verified price from both E-Commerce and Quick Commerce first.</p>
      </section>
    );
  }
  if (!comparable(e, qo)) {
    return (
      <section aria-label="Cross-mode summary" className="rounded-2xl border border-line-strong bg-surface p-4 text-sm">
        <h3 className="font-display font-semibold">Fastest / Cheapest / Best overall</h3>
        <p className="mt-1 font-medium">Not comparable</p>
        <p className="text-muted">The pack size or variant could not be matched between the two sides, so ranking them would be misleading. Compare the prices below yourself.</p>
      </section>
    );
  }
  const cheaper = e.price <= qo.price ? "E-Commerce" : "Quick Commerce";
  return (
    <section aria-label="Cross-mode summary" className="rounded-2xl border border-good/50 bg-good/5 p-4 text-sm">
      <h3 className="font-display font-semibold">Fastest / Cheapest / Best overall</h3>
      <dl className="mt-2 grid gap-2 sm:grid-cols-3">
        <div><dt className="text-xs text-muted">Fastest</dt><dd className="font-semibold">{qo.deliveryEta ? `Quick Commerce (${qp.providerName}, ${qo.deliveryEta})` : "Unknown: no ETA published"}</dd></div>
        <div><dt className="text-xs text-muted">Cheapest (item price)</dt><dd className="font-semibold">{cheaper} · {formatINR(Math.min(e.price, qo.price))}</dd></div>
        <div><dt className="text-xs text-muted">Best overall</dt><dd className="font-semibold">{cheaper === "Quick Commerce" && qo.deliveryEta ? "Quick Commerce: cheaper and faster" : "Depends on delivery fees, which are unknown"}</dd></div>
      </dl>
      <p className="mt-2 text-xs text-muted">Item prices only. Delivery, handling and platform fees are not included.</p>
    </section>
  );
}

function ItemBlock({ item, pincode }: { item: RoutedItem; pincode: string | null }) {
  const wantEco = item.mode === "ecommerce" || item.mode === "both";
  const wantQuick = item.mode === "quick" || item.mode === "both";
  const eco = useQuery({ queryKey: ["search", item.query.trim().toLowerCase()], queryFn: () => api.search(item.query.trim()), enabled: wantEco });
  const quick = useQuery({
    queryKey: ["fast-search", pincode, item.query.trim().toLowerCase()],
    queryFn: () => fastSearch(pincode as string, item.query.trim()),
    enabled: wantQuick && !!pincode,
  });
  const [tab, setTab] = useState<"eco" | "quick">("eco");

  const ecoNode = (
    <div className="space-y-4">
      {eco.isPending && <ResultsSkeleton note="Checking E-Commerce retailers live. This can take up to a minute." />}
      {eco.isError && <SourceError error={eco.error} retry={() => eco.refetch()} label="E-Commerce search" />}
      {eco.data && <SearchResults data={eco.data} showRun={false} />}
    </div>
  );
  const quickNode = (
    <div className="space-y-4">
      {!pincode && <p className="rounded-2xl border border-dashed border-line-strong p-4 text-sm text-muted">Quick Commerce is waiting for your pincode above. Nothing is checked without it.</p>}
      {pincode && quick.isPending && <ResultsSkeleton note="Checking quick-commerce apps for your pincode. This can take a while." />}
      {quick.isError && <SourceError error={quick.error} retry={() => quick.refetch()} label="Quick Commerce search" />}
      {quick.data && <QuickResults data={quick.data} />}
    </div>
  );

  return (
    <section aria-labelledby={`item-${norm(item.query)}`} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`item-${norm(item.query)}`} className="font-display text-h2 font-bold">“{item.query}”</h2>
        <Badge tone="brand">{MODE_LABEL[item.mode]}</Badge>
        <span className="text-xs text-muted">{item.reason}</span>
      </div>
      {item.mode === "both" ? (
        <>
          <Summary eco={eco.data} quick={quick.data} />
          <div className="lg:hidden">
            <Tabs label="Source" value={tab} onChange={setTab} items={[{ value: "eco", label: "E-Commerce" }, { value: "quick", label: "Quick Commerce" }]} />
          </div>
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <div className={cn(tab !== "eco" && "hidden lg:block")}>
              <h3 className="mb-3 hidden font-display font-semibold lg:block">E-Commerce</h3>
              {ecoNode}
            </div>
            <div className={cn(tab !== "quick" && "hidden lg:block")}>
              <h3 className="mb-3 hidden items-center gap-1.5 font-display font-semibold lg:flex"><Zap className="h-4 w-4" aria-hidden /> Quick Commerce</h3>
              {quickNode}
            </div>
          </div>
        </>
      ) : wantEco ? (
        ecoNode
      ) : (
        quickNode
      )}
    </section>
  );
}

export default function DiscoverView() {
  const params = useSearchParams();
  const router = useRouter();
  const q = (params.get("q") ?? "").trim();
  const modeParam = params.get("mode");
  const override: SearchMode = modeParam === "ecommerce" || modeParam === "quick" || modeParam === "both" ? modeParam : "auto";
  const [pincode, setPincode] = useState<string | null>(null);

  const intent = useQuery({ queryKey: ["intent", q.toLowerCase()], queryFn: () => fetchIntent(q), enabled: q.length > 0, retry: false });

  const items: RoutedItem[] = useMemo(() => {
    if (!q) return [];
    const base: RoutedItem[] = intent.data?.items?.length ? intent.data.items : [{ query: q, mode: "ecommerce", reason: "Routing unavailable, defaulting to E-Commerce" }];
    return override === "auto" ? base : base.map((i) => ({ ...i, mode: override as Mode, reason: "Your choice" }));
  }, [q, intent.data, override]);

  const needsPin = items.some((i) => i.mode !== "ecommerce");
  const quickItems = items.filter((i) => i.mode === "quick" || i.mode === "both");
  const overall: Mode | null = items.length === 0 ? null : override !== "auto" ? override : (intent.data?.overall ?? items[0].mode);

  function setOverride(m: SearchMode) {
    router.replace(`/discover?q=${encodeURIComponent(q)}&mode=${m}`);
  }

  if (!q) {
    return (
      <EmptyState icon={Compass} title="Search anything">
        Use the search at the top. Type or speak a request such as “milk, eggs and Samsung S24”; we split it and decide whether each item belongs in E-Commerce, Quick Commerce or both.
      </EmptyState>
    );
  }

  const battle = quickItems.length >= 2 ? `/battle?${quickItems.map((i) => `i=${encodeURIComponent(`${i.query}~1`)}`).join("&")}` : null;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="font-display text-h1 font-bold">Results for “{q}”</h1>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3">
          <p role="status" aria-live="polite" className="flex w-full min-w-0 items-center gap-2 text-sm sm:w-auto sm:flex-1">
            <Route className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            {intent.isPending && override === "auto" ? (
              "Working out where to search..."
            ) : (
              <span>
                <strong>Searching {overall ? MODE_LABEL[overall] : ""}</strong>
                {items.length > 1 ? ` · ${items.length} items` : items[0] ? ` · ${items[0].reason}` : ""}
                {intent.isError && override === "auto" ? " · auto-routing failed" : ""}
              </span>
            )}
          </p>
          <div role="radiogroup" aria-label="Override routing" className="flex w-full justify-between gap-1 overflow-x-auto rounded-xl border border-line bg-surface2 p-1 sm:inline-flex sm:w-auto">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={override === m.value}
                onClick={() => setOverride(m.value)}
                className={cn("min-h-10 cursor-pointer rounded-lg px-3 text-sm font-semibold", override === m.value ? "bg-primary text-white" : "text-muted hover:text-fg")}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        {needsPin && (
          <div className="rounded-2xl border border-line bg-surface p-4">
            <LocationSelector onChange={setPincode} />
          </div>
        )}
        {battle && (
          <Button asChild variant="secondary" size="sm">
            <Link href={battle}><Swords className="h-4 w-4" aria-hidden /> Compare this basket on Blinkit vs Zepto</Link>
          </Button>
        )}
      </div>

      {intent.isPending && override === "auto" ? <ResultsSkeleton note="Understanding your request..." /> : items.map((it, i) => <ItemBlock key={`${it.query}-${it.mode}-${i}`} item={it} pincode={pincode} />)}
    </div>
  );
}

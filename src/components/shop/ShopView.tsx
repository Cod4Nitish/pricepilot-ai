"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MapPin, ReceiptText, RefreshCw, Search, SearchX, Settings, Wallet, WifiOff } from "lucide-react";
import type { DeliveryInfo, ShopResponse, ShopWeights } from "@/lib/shop/types";
import {
  badSources, fetchDelivery, isVerifiedOffer, fetchShop, fetchShopStream, mergeDelivery, ShopStreamUnavailable, offerKey, relativeTime, ShopApiError, sortGroups, sourceName, type ShopSort,
} from "@/lib/shop-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { EmptyState, ErrorState } from "@/components/ui/state";
import { isValidPincode, LocationSelector, readSavedPincode } from "@/components/ui/location-selector";
import ParsedChips from "./ParsedChips";
import ProductRecommendationCard from "./ProductRecommendationCard";
import GroupDetail, { ComparisonTable, type DeliveryUi } from "./GroupDetail";
import { ShopLoading } from "./ShopSkeletons";
import ResearchMonitor, { ResearchLog } from "./ResearchMonitor";
import type { MonitorStep } from "@/lib/research-monitor";
import ResearchCostPanel from "./ResearchCostPanel";
import DealReceipt from "./DealReceipt";
import { SaveProductButton, SaveReportButton } from "@/components/saved/SaveButtons";

const SORTS: { id: ShopSort; label: string }[] = [
  { id: "relevance", label: "Best match" },
  { id: "price", label: "Lowest price" },
  { id: "delivery", label: "Earliest delivery" },
];

function useIsDesktop() {
  const [d, setD] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 1024px)");
    const on = () => setD(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return d;
}

function useOnline() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    setOn(navigator.onLine);
    const a = () => setOn(true), b = () => setOn(false);
    window.addEventListener("online", a);
    window.addEventListener("offline", b);
    return () => {
      window.removeEventListener("online", a);
      window.removeEventListener("offline", b);
    };
  }, []);
  return on;
}

function RunLog({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["shop-run", runId],
    enabled: open,
    retry: false,
    queryFn: async () => {
      const r = await fetch(`/api/shop/run/${encodeURIComponent(runId)}`);
      if (!r.ok) throw new Error("The step log is not available for this search.");
      return (await r.json()) as { status?: string; steps?: { at: string; label: string; status: string }[] };
    },
  });
  return (
    <details className="rounded-xl border border-line bg-surface text-sm" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="eyebrow flex min-h-11 cursor-pointer list-none items-center px-3">How this search ran</summary>
      <div className="border-t border-line px-3 py-2 text-xs text-muted">
        {q.isPending && open && "Loading step log..."}
        {q.isError && (q.error as Error).message}
        {q.data && (q.data.steps?.length ? (
          <ol className="list-decimal space-y-0.5 pl-4">
            {q.data.steps.map((s, i) => <li key={i}>{s.label} ({s.status})</li>)}
          </ol>
        ) : "No steps were recorded.")}
      </div>
    </details>
  );
}

export default function ShopView() {
  const params = useSearchParams();
  const router = useRouter();
  const q = (params.get("q") ?? "").trim();
  const pinParam = (params.get("pin") ?? "").trim();
  const wantMock = params.get("mock") === "1";
  const mockEnabled = wantMock && process.env.NODE_ENV !== "production";
  const pinParamInvalid = pinParam !== "" && !isValidPincode(pinParam);

  const [pin, setPin] = useState<string | null | undefined>(undefined); // undefined = not resolved yet
  useEffect(() => {
    if (pinParam && isValidPincode(pinParam)) setPin(pinParam);
    else setPin(readSavedPincode());
  }, [pinParam]);

  const [weights, setWeights] = useState<ShopWeights | null>(null);
  const [sort, setSort] = useState<ShopSort>("relevance");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(q);
  const [dMap, setDMap] = useState<Record<string, DeliveryInfo>>({});
  const [dLoading, setDLoading] = useState<Set<string>>(new Set());
  const [dError, setDError] = useState<string | null>(null);
  const isDesktop = useIsDesktop();
  const online = useOnline();
  const detailRef = useRef<HTMLDivElement>(null);
  const h1Ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => setDraft(q), [q]);

  const queryClient = useQueryClient();
  const queryKey = ["shop", q, pin ?? null, weights, mockEnabled] as const;
  const [costOpen, setCostOpen] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [recheckMsg, setRecheckMsg] = useState<string | null>(null);
  // Real steps streamed from POST /api/shop for the current search (never simulated).
  const [live, setLive] = useState<{ key: string; runId: string | null; steps: MonitorStep[]; startedAt: number } | null>(null);
  const query = useQuery<ShopResponse, Error>({
    queryKey,
    enabled: !!q && pin !== undefined,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
    queryFn: async ({ signal }) => {
      if (mockEnabled) {
        const m = await import("@/app/shop/__mocks__/shop-mock");
        return m.MOCK_SHOP_RESPONSE;
      }
      const args = { query: q, pincode: pin, weights: weights ?? undefined };
      const key = JSON.stringify(queryKey);
      setLive({ key, runId: null, steps: [], startedAt: Date.now() });
      let gotEvent = false;
      try {
        return await fetchShopStream(
          args,
          (ev) => {
            gotEvent = true;
            if (ev.type === "start") setLive((l) => (l && l.key === key ? { ...l, runId: ev.runId } : l));
            else if (ev.type === "step") setLive((l) => (l && l.key === key ? { ...l, steps: [...l.steps, { at: ev.at, label: ev.label, status: ev.status }] } : l));
          },
          signal,
        );
      } catch (e) {
        // Streaming unavailable before any event: fall back to the plain JSON request (same single search).
        if (e instanceof ShopStreamUnavailable && !gotEvent) return fetchShop(args, signal);
        throw e;
      }
    },
  });
  const data = query.data;
  const liveForThis = live && live.key === JSON.stringify(queryKey) ? live : null;

  // New response => cached delivery results from a previous run no longer apply.
  useEffect(() => {
    setDMap({});
    setDError(null);
  }, [q, pin]);
  useEffect(() => {
    if (data) {
      setSelectedId((cur) => (cur && data.groups.some((g) => g.id === cur) ? cur : data.groups[0]?.id ?? null));
    }
  }, [data]);
  useEffect(() => {
    if (data && !query.isFetching) h1Ref.current?.focus({ preventScroll: true });
  }, [data?.runId]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    if (!data) return [];
    return sortGroups(data.groups.map((g) => ({ ...g, offers: mergeDelivery(g.offers, dMap) })), sort);
  }, [data, dMap, sort]);
  const selected = groups.find((g) => g.id === selectedId) ?? groups[0] ?? null;

  const applyPin = useCallback(
    (p: string | null) => {
      setPin(p);
      const u = new URLSearchParams(params.toString());
      if (p) u.set("pin", p);
      else u.delete("pin");
      router.replace(`/shop?${u.toString()}`);
    },
    [params, router],
  );

  async function checkDelivery(keys?: string[]) {
    if (!selected || !pin) return;
    const pool = selected.offers.filter((o) => !keys || keys.includes(offerKey(o))).slice(0, 6);
    if (pool.length === 0) return;
    setDError(null);
    setDLoading((s) => new Set([...s, ...pool.map(offerKey)]));
    try {
      const r = await fetchDelivery(pin, pool);
      setDMap((m) => {
        const n = { ...m };
        for (const x of r.results) n[x.offerId] = x.delivery;
        return n;
      });
    } catch (e) {
      setDError(e instanceof Error ? `Delivery check failed: ${e.message}` : "Delivery check failed.");
    } finally {
      setDLoading((s) => {
        const n = new Set(s);
        pool.forEach((o) => n.delete(offerKey(o)));
        return n;
      });
    }
  }
  async function recheckPrices() {
    if (!q || rechecking) return;
    setRechecking(true);
    setRecheckMsg(null);
    try {
      if (mockEnabled) {
        setRecheckMsg("Mock mode: no fresh check was sent. Mock data is unchanged.");
        return;
      }
      const r = await fetchShop({ query: q, pincode: pin, weights: weights ?? undefined, fresh: true });
      queryClient.setQueryData(queryKey, r);
      setDMap({});
      setRecheckMsg(r.cached ? "The server returned a cached result." : "Prices re-checked.");
    } catch (e) {
      setRecheckMsg(e instanceof Error ? `Re-check failed: ${e.message}` : "Re-check failed.");
    } finally {
      setRechecking(false);
    }
  }

  const deliveryUi: DeliveryUi = { loading: dLoading, error: dError };

  function openCompare(id: string) {
    if (selectedId === id && expanded && !isDesktop) {
      setExpanded(false);
      return;
    }
    setSelectedId(id);
    setExpanded(true);
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      detailRef.current?.focus({ preventScroll: true });
    });
  }

  const detail = selected && (
    <GroupDetail
      group={selected}
      pin={pin ?? null}
      sort={sort}
      weights={weights ?? data!.weights}
      weightsPending={query.isFetching}
      onApplyWeights={setWeights}
      delivery={deliveryUi}
      onCheckDelivery={checkDelivery}
      onNeedPin={() => setPinOpen(true)}
    />
  );
  const showDetail = isDesktop || expanded;

  const err = query.error;
  const bad = data ? badSources(data) : [];

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <h1 ref={h1Ref} tabIndex={-1} className="font-display text-h1 font-extrabold tracking-tight outline-none focus:outline-none focus-visible:!outline-none">
        {q ? <>Results for &ldquo;{q}&rdquo;</> : "Shop search"}
      </h1>

      {!online && (
        <p role="status" className="flex items-center gap-2 rounded-xl border border-fg/30 bg-sun px-3 py-2 text-sm text-fg">
          <WifiOff className="h-4 w-4" aria-hidden /> You are offline. Live prices cannot be refreshed.
        </p>
      )}
      {wantMock && !mockEnabled && (
        <p role="status" className="rounded-xl border border-line bg-surface2 px-3 py-2 text-sm text-muted">Mock mode is disabled in production. Showing real results only.</p>
      )}
      {mockEnabled && (
        <p role="status" className="rounded-xl border border-fg/30 bg-sun px-3 py-2 text-sm font-semibold text-fg">DEV MOCK DATA: not real prices.</p>
      )}

      {/* Search edit + delivery chip */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setPinOpen(true)}
          aria-haspopup="dialog"
          className="chip-3d inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-line-strong bg-surface px-4 text-sm font-semibold"
        >
          <MapPin className="h-4 w-4 text-primary" aria-hidden />
          {pin ? <>Delivery to <span className="tabular">{pin}</span></> : "Set delivery pincode"}
        </button>
        {data && groups.length > 0 && <SortControl sort={sort} onChange={setSort} />}
      </div>
      {pinParamInvalid && (
        <p role="alert" className="text-sm font-medium text-bad">
          The pincode &ldquo;{pinParam}&rdquo; in the link is not valid (6 digits, cannot start with 0). It was ignored.
        </p>
      )}

      {(editing || !q) && (
        <form
          className="flex gap-2"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const v = draft.trim();
            if (!v) return;
            setEditing(false);
            setWeights(null);
            const u = new URLSearchParams({ q: v });
            if (pin) u.set("pin", pin);
            router.push(`/shop?${u.toString()}`);
          }}
        >
          <label htmlFor="shop-q" className="sr-only">Search query</label>
          <Input id="shop-q" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. best phone under 50000" autoFocus={editing} />
          <Button type="submit" disabled={!draft.trim()}><Search className="h-4 w-4" aria-hidden /> Search</Button>
        </form>
      )}

      {data && <ParsedChips parsed={data.parsed} pin={pin ?? null} onEdit={() => setEditing(true)} />}

      {!q && (
        <EmptyState icon={Search} title="Search for any product">
          Describe what you want, for example &ldquo;best phone under 50000&rdquo; or &ldquo;Galaxy S24 256GB&rdquo;, or paste a product link.
        </EmptyState>
      )}

      {q && (query.isPending || pin === undefined) && !err && (
        liveForThis && !mockEnabled ? (
          <ResearchMonitor query={q} runId={liveForThis.runId} steps={liveForThis.steps} startedAt={liveForThis.startedAt} />
        ) : (
          <ShopLoading />
        )
      )}
      {data && !query.isFetching && liveForThis && !mockEnabled && <ResearchLog steps={liveForThis.steps} />}
      {q && query.isFetching && data && (
        <p role="status" aria-live="polite" className="text-sm text-muted">Updating results...</p>
      )}

      {q && err && !query.isFetching && (
        err instanceof ShopApiError && err.notConfigured ? (
          <Card className="border-fg/30 bg-sun" role="alert">
            <div className="flex items-start gap-3">
              <Settings className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <div>
                <CardTitle>Live shopping search is not set up</CardTitle>
                <p className="mt-1 text-sm">{err.message} The server is missing its API keys. We never show sample prices; add the keys to the server environment (see the README) and reload.</p>
              </div>
            </div>
          </Card>
        ) : (
          <ErrorState title="We could not complete this search" message={err.message} onRetry={() => query.refetch()} />
        )
      )}

      {data && (
        <div aria-live="polite" className="space-y-4">
          {(data.statuses.length > 0 || data.summary) && (
            <div className="text-sm text-muted">
              <p>
                {(() => {
                  const stores = data.statuses.filter((s) => !s.source.startsWith("delivery:") && s.source !== "discovery");
                  const verifiedRetailers = new Set(groups.flatMap((g) => g.offers.filter((o) => isVerifiedOffer(o) && o.listedPrice !== null).map((o) => o.retailer.toLowerCase()))).size;
                  return `Checked ${stores.length} ${stores.length === 1 ? "store" : "stores"} · ${verifiedRetailers} with verified prices${bad.length ? ` · ${bad.length} partial or unavailable` : ""}`;
                })()}
              </p>
              <details className="mt-1 rounded-xl border border-line bg-surface">
                <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 text-xs font-semibold text-primary">Technical source diagnostics</summary>
                <div className="space-y-2 border-t border-line px-3 py-2 text-xs">
                  {data.summary && <p className="break-words">{data.summary}</p>}
                  {data.statuses.length > 0 && (
                    <ul className="list-disc space-y-0.5 pl-4">
                      {data.statuses.map((s, i) => <li key={i} className="break-words">{sourceName(s.source)}: {s.state.replace("_", " ")}{s.message ? ` (${s.message})` : ""}</li>)}
                    </ul>
                  )}
                </div>
              </details>
            </div>
          )}

          {data.recommendationProvisional && groups.length > 0 && (
            <p className="rounded-xl border border-fg/30 bg-sun px-3 py-2 text-sm text-fg">
              <span className="font-bold">PROVISIONAL:</span> some key evidence is missing, so rankings may change as more is verified.
            </p>
          )}

          {groups.length > 0 && (
            <div className="space-y-3 rounded-[1.1rem] border border-line bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={recheckPrices} disabled={rechecking || query.isFetching || !online}>
                  {rechecking ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
                  {rechecking ? "Re-checking..." : "Re-check prices now"}
                </Button>
                {data.usage && (
                  <Button variant="secondary" aria-expanded={costOpen} aria-controls="research-cost" onClick={() => setCostOpen((v) => !v)}>
                    <Wallet className="h-4 w-4" aria-hidden /> {costOpen ? "Hide research cost" : "Research cost"}
                  </Button>
                )}
                <SaveReportButton data={data} mock={mockEnabled} />
                {selected && (
                  <Button variant="secondary" aria-expanded={receiptOpen} aria-controls="deal-receipt" onClick={() => setReceiptOpen((v) => !v)}>
                    <ReceiptText className="h-4 w-4" aria-hidden /> {receiptOpen ? "Hide receipt" : "Deal receipt"}
                  </Button>
                )}
              </div>
              <p className="text-sm">
                <span className="font-semibold">
                  {data.cached ? "Cached" : data.usage?.freshCheck ? "Fresh check" : "Live"}
                </span>
                <span className="text-muted">
                  {data.cached ? ", checked " : ", generated "}
                  <time dateTime={data.generatedAt} title={new Date(data.generatedAt).toString()}>{relativeTime(data.generatedAt)}</time>
                  {data.usage && data.usage.priceMaxAgeSeconds > 0 ? `; oldest price read ${data.usage.priceMaxAgeSeconds < 60 ? `${data.usage.priceMaxAgeSeconds} s` : `${Math.round(data.usage.priceMaxAgeSeconds / 60)} min`} ago` : ""}.
                </span>
              </p>
              <p role="status" aria-live="polite" className="text-xs text-muted empty:hidden">{recheckMsg}</p>
              {costOpen && data.usage && (
                <div id="research-cost"><ResearchCostPanel usage={data.usage} cached={data.cached} /></div>
              )}
              {receiptOpen && selected && (
                <div id="deal-receipt"><DealReceipt group={selected} data={data} /></div>
              )}
            </div>
          )}

          {groups.length === 0 ? (
            <EmptyState icon={SearchX} title="No matching products found">
              {data.emptyReason ?? "No verified results for this search."}
              <ul className="mt-3 list-disc space-y-0.5 pl-5 text-left">
                <li>Use a shorter or more general name.</li>
                <li>Raise or remove the budget.</li>
                <li>Remove a feature or variant requirement.</li>
              </ul>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => setEditing(true)}>Edit search</Button>
            </EmptyState>
          ) : (
            <>
              {data.comparison && <ComparisonTable comparison={data.comparison} />}
              <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
                <section aria-labelledby="groups-h" className="min-w-0 space-y-3">
                  <h2 id="groups-h" className="font-display text-xl font-extrabold tracking-tight">
                    {data.parsed.searchIntent === "PRODUCT_RECOMMENDATION" || data.parsed.searchIntent === "FEATURE_SEARCH" ? "Recommended products" : "Matching products"}
                  </h2>
                  {(() => {
                    const priced = groups.filter((g) => g.lowestVerified !== null);
                    const unpriced = groups.filter((g) => g.lowestVerified === null);
                    const card = (g: (typeof groups)[number]) => (
                      <div key={g.id} className="space-y-3">
                        <ProductRecommendationCard
                          group={g}
                          selected={selected?.id === g.id}
                          expanded={selected?.id === g.id && showDetail}
                          onCompare={() => openCompare(g.id)}
                          extraActions={<SaveProductButton group={g} data={data} mock={mockEnabled} />}
                        />
                        {!isDesktop && expanded && selected?.id === g.id && (
                          <div ref={detailRef} tabIndex={-1} className="rounded-[1.1rem] border border-line bg-surface2 p-3 outline-none focus-visible:!outline-none">{detail}</div>
                        )}
                      </div>
                    );
                    return (
                      <>
                        {priced.length > 0 && (
                          <div className="space-y-3">
                            <h3 className="eyebrow">Verified prices ({priced.length})</h3>
                            {priced.map(card)}
                          </div>
                        )}
                        {priced.length === 0 && <p className="text-sm text-muted">No product in these results has a verified price yet.</p>}
                        {unpriced.length > 0 && (
                          <details className="rounded-[1.1rem] border border-line bg-surface2" open={priced.length === 0 || unpriced.some((g) => g.id === selected?.id && expanded) ? true : undefined}>
                            <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 text-sm font-semibold">
                              Unpriced candidates (specs found, price not verified) ({unpriced.length})
                            </summary>
                            <div className="space-y-3 border-t border-line p-3">{unpriced.map(card)}</div>
                          </details>
                        )}
                      </>
                    );
                  })()}
                </section>
                {isDesktop && (
                  <aside aria-label="Selected product offers" ref={detailRef} tabIndex={-1} className="min-w-0 space-y-4 outline-none focus-visible:!outline-none">
                    {detail}
                  </aside>
                )}
              </div>
            </>
          )}

          <p className="text-xs text-muted">
            Generated <time dateTime={data.generatedAt} title={new Date(data.generatedAt).toString()}>{relativeTime(data.generatedAt)}</time>
            {data.cached ? " (from cache)" : ""}. Prices change; open the store to confirm before buying.
          </p>
          {!(liveForThis && !mockEnabled) && <RunLog runId={data.runId} />}
        </div>
      )}

      {/* Mobile sticky action bar for the focused group */}
      {!isDesktop && data && selected && groups.length > 0 && (
        <div
          className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface px-4 py-2"
          role="region"
          aria-label={`Actions for ${selected.name}`}
        >
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-xs font-semibold">{selected.name}</p>
            <Button size="sm" onClick={() => openCompare(selected.id)}>{expanded ? "Hide prices" : "Compare"}</Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                if (!pin) return setPinOpen(true);
                setExpanded(true);
                void checkDelivery();
              }}
              disabled={dLoading.size > 0}
            >
              Check delivery
            </Button>
          </div>
        </div>
      )}

      <Sheet open={pinOpen} onClose={() => setPinOpen(false)} title="Delivery location">
        <LocationSelector
          onChange={(p) => {
            if (p !== pin) applyPin(p);
          }}
        />
      </Sheet>
    </div>
  );
}

function SortControl({ sort, onChange }: { sort: ShopSort; onChange: (s: ShopSort) => void }) {
  return (
    <div role="group" aria-label="Sort results" className="flex flex-wrap items-center gap-1.5">
      {SORTS.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={sort === s.id}
          onClick={() => onChange(s.id)}
          className={cn(
            "chip-3d min-h-11 cursor-pointer rounded-full border px-4 text-sm font-semibold",
            sort === s.id ? "border-primary bg-primary text-white" : "border-line-strong bg-surface",
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

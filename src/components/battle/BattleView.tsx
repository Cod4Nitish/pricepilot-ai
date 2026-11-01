"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Swords, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { LocationSelector } from "@/components/ui/location-selector";
import { ComparisonView } from "@/components/fast/ComparisonView";
import { ItemsEditor, linesFromParams } from "@/components/fast/ItemsEditor";
import { SetupCard } from "@/components/fast/SetupCard";
import { parseSse, safePreviewUrl } from "@/lib/fast/sse";
import type { BasketLine, BattleEvent, Comparison, ProviderId, ProviderResult, StoreBasket } from "@/lib/fast/types";

type LaneStatus = "idle" | "waiting" | "running" | "done" | "failed";
interface Lane {
  id: ProviderId;
  name: string;
  status: LaneStatus;
  log: { at: string; text: string; kind: "progress" | "info" | "error" }[];
  streamingUrl: string | null;
  result: ProviderResult | null;
  failure: string | null;
}
const LANES: { id: ProviderId; name: string }[] = [
  { id: "blinkit", name: "Blinkit" },
  { id: "zepto", name: "Zepto" },
];
const freshLanes = (s: LaneStatus): Lane[] => LANES.map((l) => ({ ...l, status: s, log: [], streamingUrl: null, result: null, failure: null }));
const hhmmss = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour12: false });

type Phase = "idle" | "connecting" | "live" | "reconnecting" | "finished" | "cancelled" | "error" | "not_configured";

export function BattleView() {
  const sp = useSearchParams();
  const [pincode, setPincode] = useState<string | null>(null);
  const [items, setItems] = useState<BasketLine[]>(() => linesFromParams(new URLSearchParams(sp.toString())));
  const [lanes, setLanes] = useState<Lane[]>(freshLanes("idle"));
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [cmp, setCmp] = useState<{ baskets: StoreBasket[]; comparison: Comparison } | null>(null);
  const battleId = useRef<string | null>(null);
  const lastSeq = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const endedRef = useRef(false);

  const apply = useCallback((e: BattleEvent) => {
    lastSeq.current = Math.max(lastSeq.current, e.seq);
    if (e.type === "battle_started") battleId.current = e.battleId ?? battleId.current;
    if (e.type === "comparison" && e.baskets && e.comparison) setCmp({ baskets: e.baskets, comparison: e.comparison });
    if (e.type === "done" || e.type === "cancelled") endedRef.current = true;
    if (e.type === "done") setPhase((p) => (p === "cancelled" ? p : "finished"));
    if (e.type === "cancelled") setPhase("cancelled");
    if (!e.provider) return;
    setLanes((ls) =>
      ls.map((l) => {
        if (l.id !== e.provider) return l;
        const n = { ...l, log: [...l.log] };
        const add = (text: string, kind: "progress" | "info" | "error") => n.log.push({ at: e.at, text, kind });
        switch (e.type) {
          case "agent_started": n.status = "running"; add(e.message ?? "Agent started", "info"); break;
          case "streaming_url": n.streamingUrl = safePreviewUrl(e.streamingUrl); add("Live browser preview available", "info"); break;
          case "progress": n.status = "running"; add(e.message ?? "", "progress"); break;
          case "provider_result": n.status = "done"; n.result = e.result ?? null; add("Extraction complete", "info"); break;
          case "provider_failed": n.status = "failed"; n.result = e.result ?? null; n.failure = e.message ?? "unavailable"; add(e.message ?? "unavailable", "error"); break;
        }
        return n;
      }),
    );
  }, []);

  const consume = useCallback(async (res: Response, signal: AbortSignal) => {
    if (!res.body) throw new Error("No stream");
    for await (const raw of parseSse(res.body)) {
      if (signal.aborted) return;
      try { apply(JSON.parse(raw.data) as BattleEvent); } catch { /* ignore malformed frame */ }
    }
  }, [apply]);

  async function start() {
    if (!pincode || items.length === 0) return;
    const ac = new AbortController();
    abort.current = ac;
    battleId.current = null;
    lastSeq.current = 0;
    endedRef.current = false;
    setLanes(freshLanes("waiting"));
    setCmp(null);
    setError(null);
    setPhase("connecting");
    try {
      const res = await fetch("/api/battle/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pincode, items }), signal: ac.signal });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        if (j?.error?.code === "NOT_CONFIGURED") { setPhase("not_configured"); setLanes(freshLanes("idle")); return; }
        setError(j?.error?.message ?? `Request failed (${res.status})`);
        setPhase("error"); setLanes(freshLanes("idle"));
        return;
      }
      setPhase("live");
      await consume(res, ac.signal);
    } catch {
      /* dropped connection: handled below */
    }
    await resume(ac);
  }

  /** If the stream dropped before 'done', resume from the last seen seq (server keeps the log). */
  async function resume(ac: AbortController) {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (ac.signal.aborted || !battleId.current) break;
      if (endedRef.current) return;
      setPhase("reconnecting");
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      try {
        const res = await fetch(`/api/battle/stream?battleId=${battleId.current}&after=${lastSeq.current}`, { signal: ac.signal });
        if (!res.ok) break;
        setPhase("live");
        await consume(res, ac.signal);
      } catch { /* retry */ }
      if (endedRef.current) return;
    }
    setPhase("error");
    setError((e) => e ?? "Lost connection to the live battle. The agents stop on their own; you can start again.");
  }

  async function cancel() {
    if (!battleId.current) return abort.current?.abort();
    try {
      await fetch("/api/battle/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ battleId: battleId.current }) });
    } catch { /* stream will still end on its own */ }
  }

  useEffect(() => () => abort.current?.abort(), []);
  const running = phase === "connecting" || phase === "live" || phase === "reconnecting";
  const announce = phase === "live" ? "Battle in progress" : phase === "finished" ? "Battle finished" : phase === "cancelled" ? "Battle cancelled" : "";

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Live Deal Battle</h1>
        <p className="mt-1 text-sm text-muted">Blinkit vs Zepto, same basket, same pincode. You are watching real browser agents work; nothing is simulated. We never log in, bypass CAPTCHAs or check out.</p>
      </header>
      <Card className="space-y-4">
        <LocationSelector onChange={setPincode} />
        <ItemsEditor items={items} onChange={setItems} disabled={running} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={start} disabled={!pincode || items.length === 0 || running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Swords className="h-4 w-4" aria-hidden />} Start battle
          </Button>
          {running && (
            <Button variant="danger" onClick={cancel}><Square className="h-4 w-4" aria-hidden /> Cancel</Button>
          )}
        </div>
      </Card>
      <p className="sr-only" aria-live="polite">{announce}</p>
      {phase === "not_configured" && <SetupCard />}
      {phase === "reconnecting" && <p className="text-sm text-warn" role="status">Connection dropped. Reconnecting and resuming where we left off...</p>}
      {error && <Card role="alert" className="border-bad/40"><CardTitle>Battle problem</CardTitle><p className="mt-2 text-sm text-muted">{error}</p></Card>}
      {phase === "cancelled" && <p className="text-sm text-muted" role="status">Cancelled. Partial results below (if any) are real but incomplete.</p>}

      {phase !== "idle" && phase !== "not_configured" && (
        <div className="grid gap-4 md:grid-cols-2">
          {lanes.map((l) => <LaneCard key={l.id} lane={l} />)}
        </div>
      )}
      {cmp && <ComparisonView baskets={cmp.baskets} comparison={cmp.comparison} />}
    </div>
  );
}

const chip: Record<LaneStatus, { tone: "neutral" | "brand" | "good" | "bad"; label: string }> = {
  idle: { tone: "neutral", label: "Idle" },
  waiting: { tone: "neutral", label: "Waiting for agent" },
  running: { tone: "brand", label: "Agent working" },
  done: { tone: "good", label: "Finished" },
  failed: { tone: "bad", label: "Unavailable" },
};

function LaneCard({ lane }: { lane: Lane }) {
  const c = chip[lane.status];
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <CardTitle>{lane.name}</CardTitle>
        <Badge tone={c.tone}>{lane.status === "running" && <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden />}{c.label}</Badge>
      </div>
      {lane.streamingUrl && (
        <iframe
          src={lane.streamingUrl}
          title={`${lane.name} live browser preview`}
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          loading="lazy"
          className="h-48 w-full rounded-xl border border-line bg-surface2"
        />
      )}
      <ol className="max-h-48 space-y-1 overflow-y-auto text-xs" aria-label={`${lane.name} progress log`}>
        {lane.log.length === 0 && <li className="text-muted">No events yet.</li>}
        {lane.log.map((e, i) => (
          <li key={i} className={e.kind === "error" ? "text-bad" : e.kind === "info" ? "text-muted" : ""}>
            <time className="mr-2 tabular-nums text-muted">{hhmmss(e.at)}</time>{e.text}
          </li>
        ))}
      </ol>
      {lane.failure && <p className="text-sm text-bad" role="status">{lane.failure}</p>}
      {lane.result && lane.result.lines.length > 0 && (
        <ul className="divide-y divide-line text-sm">
          {lane.result.lines.map((l) => (
            <li key={l.query} className="py-1.5">
              {l.offer ? `${l.offer.title}: ₹${l.offer.price}` : `${l.query}: ${l.resolution.replace("_", " ")}`}
              {l.offer?.evidence && <span className="block truncate text-xs italic text-muted">&ldquo;{l.offer.evidence}&rdquo;</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

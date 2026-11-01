"use client";
// "Monitor price" for one saved product (local mode). Shows only real observations (from saves/refreshes/checks).
import { lazy, Suspense, useEffect, useId, useState } from "react";
import { Bell, BellOff, Info } from "lucide-react";
import { savedDb } from "@/lib/saved/db";
import { bestVerifiedPrice, isVerifiedStatus, MONITOR_MAX_PER_SESSION, type SavedProduct } from "@/lib/saved/snapshot";
import { relativeTime, rupees } from "@/lib/shop-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import VerificationBadge from "@/components/product/VerificationBadge";
import { formatDate } from "./SavedGroupView";

const HistoryChart = lazy(() => import("./HistoryChart"));

export const LOCAL_MONITOR_NOTE = "Checks run only while PricePilot is open in this browser. No email/push/background alerts are configured.";

function Toggle({ id, checked, onChange, label, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface px-3 py-2">
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-primary" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}: {checked ? "On" : "Off"}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export default function PriceMonitorPanel({ product }: { product: SavedProduct }) {
  const m = product.monitor;
  const ids = { target: useId(), on: useId(), drop: useId() };
  const [target, setTarget] = useState(m.targetPrice?.toString() ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  useEffect(() => setTarget(m.targetPrice?.toString() ?? ""), [m.targetPrice]);
  useEffect(() => setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission), []);

  async function update(patch: Partial<SavedProduct["monitor"]>, note: string) {
    try {
      const cur = (await savedDb.getProduct(product.id)) ?? product;
      await savedDb.putProduct({ ...cur, monitor: { ...cur.monitor, ...patch } });
      setMsg(note);
    } catch (e) {
      setMsg(e instanceof Error ? `Could not update: ${e.message}` : "Could not update.");
    }
  }

  const targetNum = Number(target);
  const targetValid = target.trim() !== "" && Number.isFinite(targetNum) && targetNum > 0;
  const lastVerified = [...product.history].reverse().find((o) => isVerifiedStatus(o.verificationStatus)) ?? null;
  const best = bestVerifiedPrice(product.offers);
  const hist = [...product.history].reverse();

  return (
    <section aria-labelledby="monitor-h" className="space-y-3 rounded-[1.1rem] border border-line bg-surface2 p-3 sm:p-4">
      <h2 id="monitor-h" className="font-display text-xl font-extrabold tracking-tight">Monitor price</h2>
      <p role="note" className="flex items-start gap-2 rounded-xl border border-fg/30 bg-sun px-3 py-2 text-sm text-fg">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          {LOCAL_MONITOR_NOTE}
          <span className="block text-xs">At most one check per product every 6 hours and {MONITOR_MAX_PER_SESSION} products per browser session. Only verified prices count toward the target.</span>
        </span>
      </p>
      {product.devMock && <p className="text-xs font-semibold text-warn">Dev mock snapshot: automatic checks are skipped for mock data.</p>}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!target.trim()) return void update({ targetPrice: null }, "Target price cleared.");
          if (targetValid) void update({ targetPrice: Math.round(targetNum) }, `Target set to ${rupees(Math.round(targetNum))}.`);
        }}
      >
        <div className="min-w-0 flex-1 basis-48">
          <label htmlFor={ids.target} className="text-xs font-semibold">Target price (INR)</label>
          <Input id={ids.target} type="number" inputMode="numeric" min={1} step={1} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. 60000" aria-describedby={`${ids.target}-h`} />
          <p id={`${ids.target}-h`} className="text-xs text-muted">Current target: {m.targetPrice === null ? "not set" : rupees(m.targetPrice)}</p>
        </div>
        <Button type="submit" variant="secondary" disabled={target.trim() !== "" && !targetValid}>{target.trim() ? "Set target" : "Clear target"}</Button>
      </form>

      <div className="grid gap-2 sm:grid-cols-2">
        <Toggle id={ids.on} checked={m.enabled} onChange={(v) => update({ enabled: v }, v ? "Monitoring on (runs only while the app is open)." : "Monitoring off.")} label="Monitoring" hint="Uses cached-friendly checks while PricePilot is open." />
        <Toggle id={ids.drop} checked={m.dropAlert} onChange={(v) => update({ dropAlert: v }, v ? "Price-drop alert on." : "Price-drop alert off.")} label="Price-drop alert" hint="In-app notice when a check finds a lower verified price." />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {perm === "granted" ? (
          <Badge tone="good"><Bell className="h-3.5 w-3.5" aria-hidden /> Browser notifications allowed</Badge>
        ) : perm === "denied" ? (
          <Badge tone="neutral"><BellOff className="h-3.5 w-3.5" aria-hidden /> Browser notifications blocked (in-app notices only)</Badge>
        ) : perm === "unsupported" ? (
          <span className="text-xs text-muted">This browser does not support notifications; in-app notices only.</span>
        ) : (
          <Button size="sm" variant="secondary" onClick={async () => setPerm(await Notification.requestPermission())}>
            <Bell className="h-4 w-4" aria-hidden /> Allow browser notifications
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-surface p-2">
          <dt className="text-xs text-muted">Last checked</dt>
          <dd className="font-medium">{m.lastCheckedAt ? <><time dateTime={m.lastCheckedAt}>{relativeTime(m.lastCheckedAt)}</time> <span className="block text-xs text-muted">{formatDate(m.lastCheckedAt)}</span></> : "Never checked"}</dd>
        </div>
        <div className="rounded-xl border border-line bg-surface p-2">
          <dt className="text-xs text-muted">Last observed verified price</dt>
          <dd className="font-medium">{lastVerified ? <><span className="tabular">{rupees(lastVerified.price)}</span> at {lastVerified.retailer}<span className="block text-xs text-muted">{formatDate(lastVerified.at)}</span></> : "None verified"}</dd>
        </div>
        <div className="rounded-xl border border-line bg-surface p-2">
          <dt className="text-xs text-muted">Snapshot lowest verified</dt>
          <dd className="font-medium">{best ? <><span className="tabular">{rupees(best.price)}</span> at {best.retailer}</> : "None verified"}</dd>
        </div>
      </dl>
      {m.lastResult && <p className="text-xs text-muted">Last check result: {m.lastResult}</p>}
      <p role="status" aria-live="polite" className="text-xs empty:hidden">{msg}</p>

      <div className="space-y-2">
        <h3 className="font-display text-lg font-bold tracking-tight">Price observations ({product.history.length})</h3>
        <p className="text-xs text-muted">Only prices actually observed in saves, refreshes or checks. Nothing is estimated or back-filled.</p>
        {product.history.length >= 2 && (
          <Suspense fallback={<div className="h-56 rounded-xl bg-surface" />}>
            <HistoryChart points={product.history} />
          </Suspense>
        )}
        {product.history.length === 0 ? (
          <p className="text-sm text-muted">No price has been observed yet.</p>
        ) : (
          <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line bg-surface">
            {hist.map((o, i) => (
              <li key={`${o.at}-${o.retailer}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="tabular font-semibold">{rupees(o.price)}</span>
                <span>{o.retailer}</span>
                <VerificationBadge value={o.verificationStatus} />
                <time dateTime={o.at} className="text-xs text-muted">{formatDate(o.at)}</time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

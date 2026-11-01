"use client";
// Local-only price monitor. Runs ONLY while the app is open in this browser and only for products the user
// switched monitoring on for. Limits: one check per product per 6 h (claimed in IndexedDB before the request,
// so other tabs skip it), at most 3 products per browser session, sequential, cache-friendly (fresh: false).
// No background, email or push alerts exist.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BellRing, X } from "lucide-react";
import { fetchShop } from "@/lib/shop-client";
import { idbAvailable, savedDb } from "@/lib/saved/db";
import { applyRefresh, bestVerifiedPrice, dueForCheck, MONITOR_MAX_PER_SESSION, refreshQuery, targetHit, type SavedProduct } from "@/lib/saved/snapshot";
import { rupees } from "@/lib/shop-client";

const SESSION_KEY = "pricepilot:monitor-session-checks";
const TICK_MS = 15 * 60 * 1000;

function sessionChecked(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}
function markSessionChecked(id: string) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify([...sessionChecked(), id]));
  } catch {
    /* ignore */
  }
}

interface Notice {
  id: string;
  productId: string;
  text: string;
}

async function checkOne(p: SavedProduct): Promise<Notice | null> {
  const claimed = await savedDb.claimCheck(p.id, new Date());
  if (!claimed) return null; // another tab checked it, or it is no longer due/enabled
  markSessionChecked(p.id);
  const prevBest = bestVerifiedPrice(claimed.offers);
  try {
    const res = await fetchShop({ query: refreshQuery(claimed), fresh: false });
    const out = applyRefresh(claimed, res, new Date());
    if (out.kind === "different") {
      await savedDb.putProduct({ ...claimed, monitor: { ...claimed.monitor, lastResult: "Check returned a different product; snapshot not changed." } });
      return null;
    }
    const best = bestVerifiedPrice(out.product.offers);
    const hit = targetHit(claimed.monitor.targetPrice, best);
    const dropped = claimed.monitor.dropAlert && best !== null && prevBest !== null && best.price < prevBest.price;
    const result = best ? `Lowest verified price ${rupees(best.price)} at ${best.retailer}${res.cached ? " (server cache)" : ""}.` : "No verified price found in this check.";
    await savedDb.putProduct({ ...out.product, monitor: { ...out.product.monitor, lastCheckedAt: claimed.monitor.lastCheckedAt, lastResult: result } });
    if (!best || (!hit && !dropped)) return null;
    const text = hit
      ? `${claimed.name}: verified price ${rupees(best.price)} at ${best.retailer} is at or below your target ${rupees(claimed.monitor.targetPrice)}.`
      : `${claimed.name}: verified price dropped to ${rupees(best.price)} at ${best.retailer} (was ${rupees(prevBest!.price)}).`;
    return { id: `${p.id}-${Date.now()}`, productId: p.id, text };
  } catch (e) {
    await savedDb.putProduct({ ...claimed, monitor: { ...claimed.monitor, lastResult: e instanceof Error ? `Check failed: ${e.message}` : "Check failed." } }).catch(() => {});
    return null;
  }
}

export default function LocalPriceMonitor() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const running = useRef(false);

  useEffect(() => {
    if (!idbAvailable()) return;
    let stopped = false;
    async function run() {
      if (running.current || stopped || !navigator.onLine) return;
      const done = new Set(sessionChecked());
      const budget = MONITOR_MAX_PER_SESSION - done.size;
      if (budget <= 0) return;
      running.current = true;
      try {
        const all = await savedDb.listProducts();
        // dev mock snapshots never trigger real network checks
        const due = dueForCheck(all.filter((p) => !p.devMock), Date.now(), budget, done);
        for (const p of due) {
          if (stopped) break;
          const n = await checkOne(p); // sequential by design
          if (n) {
            setNotices((cur) => [...cur, n]);
            try {
              if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("PricePilot price alert", { body: n.text });
            } catch {
              /* notifications unsupported */
            }
          }
        }
      } catch {
        /* storage unavailable: nothing to monitor */
      } finally {
        running.current = false;
      }
    }
    const first = window.setTimeout(run, 5000);
    const t = window.setInterval(run, TICK_MS);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, []);

  if (notices.length === 0) return null;
  return (
    <div role="status" aria-live="polite" className="no-print fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-md space-y-2 lg:bottom-4">
      {notices.map((n) => (
        <div key={n.id} className="flex items-start gap-2 rounded-xl border border-fg/30 bg-mint px-3 py-2 text-sm text-fg shadow-pop">
          <BellRing className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">
            <span className="font-semibold">Price alert (local check): </span>
            {n.text}{" "}
            <Link href={`/saved/product?id=${encodeURIComponent(n.productId)}`} className="font-semibold underline">Open</Link>
          </p>
          <button
            type="button"
            aria-label="Dismiss alert"
            onClick={() => setNotices((cur) => cur.filter((x) => x.id !== n.id))}
            className="-my-1 grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg hover:bg-surface"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

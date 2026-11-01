"use client";
// "Save product" and "Save research" actions for /shop results. Writes to IndexedDB only (no network).
import { useState } from "react";
import Link from "next/link";
import { Bookmark, BookmarkCheck, FileDown, Loader2 } from "lucide-react";
import type { ProductGroup, ShopResponse } from "@/lib/shop/types";
import { savedDb } from "@/lib/saved/db";
import { buildSavedProduct, buildSavedReport, identityKey, sanitizeGroup } from "@/lib/saved/snapshot";
import { Button } from "@/components/ui/button";

type Status = { tone: "ok" | "err"; text: string; href?: string } | null;

export function newReportId(): string {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `r-${Date.now().toString(36)}-${rnd.slice(0, 8)}`;
}

function StatusLine({ s }: { s: Status }) {
  return (
    <p role="status" aria-live="polite" className="text-xs empty:hidden">
      {s && (
        <span className={s.tone === "err" ? "text-bad" : "text-fg"}>
          {s.text}
          {s.href && (
            <>
              {" "}
              <Link href={s.href} className="font-semibold text-primary underline">Open saved</Link>
            </>
          )}
        </span>
      )}
    </p>
  );
}

export function SaveProductButton({ group, data, mock = false }: { group: ProductGroup; data: Pick<ShopResponse, "parsed" | "generatedAt">; mock?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const key = identityKey(sanitizeGroup(group));
      const existing = await savedDb.getProduct(key);
      const rec = buildSavedProduct(group, data, new Date(), existing, { devMock: mock });
      await savedDb.putProduct(rec);
      const href = `/saved/product?id=${encodeURIComponent(rec.id)}`;
      setStatus({ tone: "ok", text: existing ? "Updated saved snapshot." : mock ? "Saved (dev mock data)." : "Saved on this device.", href });
    } catch (e) {
      setStatus({ tone: "err", text: e instanceof Error ? `Could not save: ${e.message}` : "Could not save." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <Button variant="secondary" onClick={save} disabled={busy} aria-label={`Save product ${group.name}`}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : status?.tone === "ok" ? <BookmarkCheck className="h-4 w-4" aria-hidden /> : <Bookmark className="h-4 w-4" aria-hidden />}
        {busy ? "Saving" : "Save product"}
      </Button>
      <StatusLine s={status} />
    </div>
  );
}

export function SaveReportButton({ data, mock = false }: { data: ShopResponse; mock?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const rec = buildSavedReport(data, new Date(), newReportId(), null, mock);
      await savedDb.putReport(rec);
      setStatus({ tone: "ok", text: "Research saved on this device.", href: `/saved/report?id=${encodeURIComponent(rec.id)}` });
    } catch (e) {
      setStatus({ tone: "err", text: e instanceof Error ? `Could not save: ${e.message}` : "Could not save." });
    } finally {
      setBusy(false);
    }
  }
  // display:contents so the button sits in the parent toolbar row and the status wraps onto its own line
  return (
    <div className="contents">
      <Button variant="secondary" onClick={save} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileDown className="h-4 w-4" aria-hidden />}
        {busy ? "Saving" : "Save research"}
      </Button>
      <div className="basis-full empty:hidden"><StatusLine s={status} /></div>
    </div>
  );
}

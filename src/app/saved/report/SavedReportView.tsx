"use client";
// Opens a saved research report from IndexedDB. Rendering makes ZERO /api calls.
// "Refresh research" is explicit and saves the result as a NEW dated report version (the old one is kept).
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ClipboardCopy, Download, FileText, Loader2, Printer, RefreshCw, Trash2 } from "lucide-react";
import type { ShopResponse } from "@/lib/shop/types";
import { budgetLabel, categoryLabel, fetchShop, intentLabel, sourceName } from "@/lib/shop-client";
import { savedDb } from "@/lib/saved/db";
import { useSavedReport } from "@/lib/saved/hooks";
import { buildSavedReport, reportSummaryText, type SavedReport } from "@/lib/saved/snapshot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/state";
import ConfirmDialog from "@/components/saved/ConfirmDialog";
import LocalOnlyNote from "@/components/saved/LocalOnlyNote";
import { newReportId } from "@/components/saved/SaveButtons";
import { formatDate, SavedGroupView, SnapshotBanner } from "@/components/saved/SavedGroupView";

const STATE_LABEL: Record<string, string> = {
  ok: "OK", partial: "Partial", blocked: "Blocked", login_required: "Login required", no_results: "No results", error: "Error", timeout: "Timed out", skipped: "Skipped", disabled: "Disabled",
};

function downloadJson(r: SavedReport) {
  const blob = new Blob([JSON.stringify(r, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const slug = r.query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "report";
  a.href = url;
  a.download = `pricepilot-${slug}-${r.generatedAt.slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SavedReportView() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id");
  const q = useSavedReport(id);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const r = q.data ?? null;

  // expand collapsed details so the printed report contains the breakdowns
  useEffect(() => {
    const open = () => document.querySelectorAll("main details").forEach((d) => d.setAttribute("open", ""));
    window.addEventListener("beforeprint", open);
    return () => window.removeEventListener("beforeprint", open);
  }, []);

  async function copySummary() {
    if (!r) return;
    try {
      await navigator.clipboard.writeText(reportSummaryText(r));
      setMsg("Summary copied to the clipboard.");
    } catch {
      setMsg("Could not copy: the browser blocked clipboard access.");
    }
  }

  async function refreshResearch() {
    if (!r) return;
    setBusy(true);
    setMsg(null);
    try {
      let res: ShopResponse;
      if (r.devMock && process.env.NODE_ENV !== "production") {
        res = (await import("@/app/shop/__mocks__/shop-mock")).MOCK_SHOP_RESPONSE; // dev only, no network
      } else {
        res = await fetchShop({ query: r.query, fresh: true });
      }
      const next = buildSavedReport(res, new Date(), newReportId(), r.id, !!r.devMock);
      await savedDb.putReport(next);
      router.push(`/saved/report?id=${encodeURIComponent(next.id)}`);
      setMsg("Saved as a new report version. The previous version is kept.");
    } catch (e) {
      setMsg(e instanceof Error ? `Refresh failed: ${e.message}` : "Refresh failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!id) return <EmptyState icon={FileText} title="No saved report selected" action={<Button asChild variant="secondary"><Link href="/saved">Go to Saved</Link></Button>} />;
  if (q.isPending) return <Skeleton className="h-80 w-full" />;
  if (q.isError) return <ErrorState title="Could not open this saved report" message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  if (!r) {
    return (
      <EmptyState icon={FileText} title="Saved report not found" action={<Button asChild variant="secondary"><Link href="/saved">Go to Saved</Link></Button>}>
        It may have been deleted, or it was saved in a different browser or device.
      </EmptyState>
    );
  }

  const budget = budgetLabel(r.budgetMin, r.budgetMax);
  const cost = r.researchCost;
  return (
    <div className="space-y-5">
      <Link href="/saved" className="no-print inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden /> All saved
      </Link>
      <div className="space-y-2">
        <p className="eyebrow">Saved research report</p>
        <h1 className="break-words font-display text-h1 font-extrabold tracking-tight">&ldquo;{r.query}&rdquo;</h1>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="brand">{intentLabel(r.intent)}</Badge>
          <Badge tone="neutral">{categoryLabel(r.category)}</Badge>
          {budget && <Badge tone="neutral">{budget}</Badge>}
          {r.preferredFeatures.map((f) => <Badge key={f} tone="neutral">Wants {f}</Badge>)}
          {r.excludedFeatures.map((f) => <Badge key={f} tone="neutral">Avoids {f}</Badge>)}
          {r.previousId && <Badge tone="neutral">Refreshed version</Badge>}
        </div>
      </div>
      {r.devMock && <p role="status" className="rounded-xl border border-fg/30 bg-sun px-3 py-2 text-sm font-semibold text-fg">DEV MOCK DATA: not real prices.</p>}
      <SnapshotBanner observedAt={r.generatedAt} savedAt={r.savedAt} kind="research" />

      <div className="no-print flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={copySummary}><ClipboardCopy className="h-4 w-4" aria-hidden /> Copy summary</Button>
        <Button variant="secondary" onClick={() => downloadJson(r)}><Download className="h-4 w-4" aria-hidden /> Download JSON</Button>
        <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> Print / Save as PDF</Button>
        <Button variant="secondary" onClick={() => setConfirmRefresh(true)} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
          {busy ? "Refreshing..." : "Refresh research"}
        </Button>
        <Button variant="danger" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" aria-hidden /> Delete</Button>
      </div>
      <p role="status" aria-live="polite" className="no-print text-sm empty:hidden">{msg}</p>

      {r.summary && (
        <section aria-label="Summary">
          <p className="eyebrow">Summary (when researched)</p>
          <p className="mt-1 text-sm">{r.summary}</p>
        </section>
      )}
      {r.recommendationProvisional && r.groups.length > 0 && (
        <p className="rounded-xl border border-fg/30 bg-sun px-3 py-2 text-sm text-fg"><span className="font-bold">PROVISIONAL:</span> some key evidence was missing when this was researched.</p>
      )}
      {r.groups.length === 0 && <p className="text-sm text-muted">{r.emptyReason ?? "No matching products were found."}</p>}

      <div className="space-y-6">
        {r.groups.map((g, i) => (
          <section key={g.key + i} aria-label={`Product ${i + 1}: ${g.name}`} className="print-break space-y-3 rounded-[1.1rem] border border-line bg-surface p-3 sm:p-4">
            <p className="eyebrow">#{i + 1}</p>
            <SavedGroupView g={g} headingLevel={2} />
          </section>
        ))}
      </div>

      {r.sourcesChecked.length > 0 && (
        <section aria-labelledby="sources-h" className="space-y-2">
          <h2 id="sources-h" className="font-display text-lg font-bold tracking-tight">Sources checked</h2>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {r.sourcesChecked.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold">{sourceName(s.source)}</span>
                <Badge tone={s.state === "ok" ? "good" : s.state === "partial" || s.state === "no_results" ? "warn" : "neutral"}>{STATE_LABEL[s.state] ?? s.state}</Badge>
                <span className="text-xs text-muted">{s.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cost && (
        <section aria-labelledby="cost-h" className="space-y-2">
          <h2 id="cost-h" className="font-display text-lg font-bold tracking-tight">Research cost (when researched)</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-muted">Search requests</dt><dd className="tabular font-medium">{cost.tinyfishSearchRequests}</dd></div>
            <div><dt className="text-xs text-muted">Pages fetched</dt><dd className="tabular font-medium">{cost.tinyfishFetchUrls}</dd></div>
            <div><dt className="text-xs text-muted">Paid agent runs / steps</dt><dd className="tabular font-medium">{cost.paidAgentRuns} / {cost.paidAgentSteps}</dd></div>
            <div><dt className="text-xs text-muted">Calculated agent cost</dt><dd className="tabular font-medium">{cost.computedUsd === null ? "Unknown" : `$${cost.computedUsd.toFixed(3)}`}</dd></div>
          </dl>
          <p className="text-xs text-muted">{cost.basis} {cost.billed}</p>
          {r.cached && <p className="text-xs text-muted">This result came from the server cache.</p>}
        </section>
      )}

      <p className="text-xs text-muted">Research generated {formatDate(r.generatedAt)}; saved {formatDate(r.savedAt)}. Prices change; open the store to confirm before buying.</p>
      <div className="no-print"><LocalOnlyNote /></div>

      <ConfirmDialog
        open={confirmRefresh}
        onClose={() => setConfirmRefresh(false)}
        title="Refresh this research?"
        description={`Runs a new search for "${r.query}" (may use research credits) and saves it as a new dated report. This report is kept.`}
        confirmLabel="Refresh research"
        onConfirm={refreshResearch}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete saved report?"
        description={`The report for "${r.query}" will be removed from this browser. This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          await savedDb.deleteReport(r.id);
          router.push("/saved");
        }}
      />
    </div>
  );
}

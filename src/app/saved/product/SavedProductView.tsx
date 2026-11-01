"use client";
// Opens a saved product snapshot from IndexedDB. Rendering makes ZERO /api calls.
// The only network call on this page is the explicit "Refresh prices" button.
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Bookmark, Loader2, RefreshCw, Trash2 } from "lucide-react";
import type { ShopResponse } from "@/lib/shop/types";
import { fetchShop, rupees } from "@/lib/shop-client";
import { savedDb } from "@/lib/saved/db";
import { useSavedProduct } from "@/lib/saved/hooks";
import { applyRefresh, bestVerifiedPrice, refreshQuery, sanitizeGroup } from "@/lib/saved/snapshot";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/state";
import ConfirmDialog from "@/components/saved/ConfirmDialog";
import { SavedGroupView, SnapshotBanner, snapshotObservedAt } from "@/components/saved/SavedGroupView";
import LocalOnlyNote from "@/components/saved/LocalOnlyNote";

type RefreshState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "updated"; text: string }
  | { kind: "different"; text: string; returned: { name: string; price: number | null; retailer: string | null }[]; query: string }
  | { kind: "error"; text: string };

export default function SavedProductView() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id");
  const q = useSavedProduct(id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refresh, setRefresh] = useState<RefreshState>({ kind: "idle" });
  const p = q.data ?? null;

  async function doRefresh() {
    if (!p) return;
    setRefresh({ kind: "running" });
    const query = refreshQuery(p);
    try {
      let res: ShopResponse;
      if (p.devMock && process.env.NODE_ENV !== "production") {
        // dev only: never spend credits on mock snapshots
        res = (await import("@/app/shop/__mocks__/shop-mock")).MOCK_SHOP_RESPONSE;
      } else {
        res = await fetchShop({ query, fresh: true });
      }
      const latest = (await savedDb.getProduct(p.id)) ?? p;
      const out = applyRefresh(latest, res, new Date());
      if (out.kind === "different") {
        setRefresh({
          kind: "different",
          text: out.message,
          query,
          returned: res.groups.slice(0, 5).map((g) => {
            const sg = sanitizeGroup(g);
            const b = bestVerifiedPrice(sg.offers);
            return { name: sg.name, price: b?.price ?? null, retailer: b?.retailer ?? null };
          }),
        });
        return;
      }
      await savedDb.putProduct(out.product);
      const b = bestVerifiedPrice(out.product.offers);
      setRefresh({
        kind: "updated",
        text:
          `${p.devMock ? "Dev mock: refreshed from mock data, no network call. " : res.cached ? "The server returned a cached result. " : "Prices re-checked. "}` +
          `Snapshot updated; ${out.added} new price observation${out.added === 1 ? "" : "s"} added.` +
          (b ? ` Lowest verified now ${rupees(b.price)} at ${b.retailer}.` : " No verified price in this result."),
      });
    } catch (e) {
      setRefresh({ kind: "error", text: e instanceof Error ? `Refresh failed: ${e.message}` : "Refresh failed." });
    }
  }

  if (!id) {
    return <EmptyState icon={Bookmark} title="No saved product selected" action={<Button asChild variant="secondary"><Link href="/saved">Go to Saved</Link></Button>} />;
  }
  if (q.isPending) return <Skeleton className="h-80 w-full" />;
  if (q.isError) return <ErrorState title="Could not open this saved product" message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  if (!p) {
    return (
      <EmptyState icon={Bookmark} title="Saved product not found" action={<Button asChild variant="secondary"><Link href="/saved">Go to Saved</Link></Button>}>
        It may have been deleted, or it was saved in a different browser or device.
      </EmptyState>
    );
  }

  const observed = snapshotObservedAt(p, p.researchGeneratedAt);
  return (
    <div className="space-y-5">
      <Link href="/saved" className="no-print inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary">
        <ArrowLeft className="h-4 w-4" aria-hidden /> All saved
      </Link>
      {p.devMock && <p role="status" className="rounded-xl border border-fg/30 bg-sun px-3 py-2 text-sm font-semibold text-fg">DEV MOCK DATA: not real prices.</p>}
      <SnapshotBanner observedAt={observed} savedAt={p.updatedAt} />

      <div className="no-print flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={doRefresh} disabled={refresh.kind === "running"}>
          {refresh.kind === "running" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
          {refresh.kind === "running" ? "Refreshing..." : "Refresh prices"}
        </Button>
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="h-4 w-4" aria-hidden /> Delete
        </Button>
      </div>
      <p className="text-xs text-muted">Refresh runs a new search for &ldquo;{refreshQuery(p)}&rdquo; and may use research credits. It only updates this snapshot if the same product and variant is found.</p>
      <div role="status" aria-live="polite" className="empty:hidden">
        {refresh.kind === "updated" && <p className="rounded-xl border border-fg/30 bg-mint px-3 py-2 text-sm text-fg">{refresh.text}</p>}
        {refresh.kind === "error" && <p className="rounded-xl border border-bad/40 bg-peach px-3 py-2 text-sm text-fg">{refresh.text}</p>}
        {refresh.kind === "different" && (
          <div className="space-y-1 rounded-xl border border-fg/30 bg-peach px-3 py-2 text-sm text-fg">
            <p className="font-semibold">{refresh.text}</p>
            {refresh.returned.length === 0 ? (
              <p>The refresh found no matching products.</p>
            ) : (
              <>
                <p>The refresh returned:</p>
                <ul className="list-disc pl-5">
                  {refresh.returned.map((r, i) => (
                    <li key={i}>{r.name}: {r.price !== null ? `${rupees(r.price)} at ${r.retailer}` : "no verified price"}</li>
                  ))}
                </ul>
              </>
            )}
            <Link href={`/shop?q=${encodeURIComponent(refresh.query)}`} className="inline-flex min-h-11 items-center font-semibold text-primary underline">Open these results in search</Link>
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
        <div className="min-w-0">
          <SavedGroupView g={p} headingLevel={1} />
          <p className="mt-3 text-xs text-muted">Originally searched as &ldquo;{p.query}&rdquo;.</p>
        </div>
        <div className="min-w-0 space-y-3">
          <LocalOnlyNote />
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete saved product?"
        description={`"${p.name}" and its saved price observations will be removed from this browser. This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          await savedDb.deleteProduct(p.id);
          router.push("/saved");
        }}
      />
    </div>
  );
}

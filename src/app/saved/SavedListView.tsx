"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Bookmark, FileText, Search } from "lucide-react";
import { useSavedProducts, useSavedReports } from "@/lib/saved/hooks";
import { idbAvailable } from "@/lib/saved/db";
import { intentLabel, relativeTime, rupees } from "@/lib/shop-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/state";
import { ProductImage } from "@/components/product/ProductCard";
import { formatDate, variantLabel } from "@/components/saved/SavedGroupView";
import LocalOnlyNote from "@/components/saved/LocalOnlyNote";

export default function SavedListView() {
  const products = useSavedProducts();
  const reports = useSavedReports();
  const [noIdb, setNoIdb] = useState(false);
  useEffect(() => setNoIdb(!idbAvailable()), []);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-h1 font-extrabold tracking-tight">Saved</h1>
        <p className="text-sm text-muted">Products and research you saved from a search. Opening them uses the saved snapshot: nothing is re-researched unless you press Refresh.</p>
        <LocalOnlyNote />
      </div>

      {noIdb && <ErrorState title="Local storage is unavailable" message="This browser does not allow IndexedDB (for example some private modes), so nothing can be saved here." />}

      <section aria-labelledby="saved-products-h" className="space-y-3">
        <h2 id="saved-products-h" className="font-display text-xl font-extrabold tracking-tight">Products{products.data ? ` (${products.data.length})` : ""}</h2>
        {products.isPending && !noIdb && <Skeleton className="h-28 w-full" />}
        {products.isError && <ErrorState title="Could not read saved products" message={(products.error as Error).message} onRetry={() => products.refetch()} />}
        {products.data?.length === 0 && (
          <EmptyState icon={Bookmark} title="No saved products yet" action={<Button asChild variant="secondary"><Link href="/discover"><Search className="h-4 w-4" aria-hidden /> Search products</Link></Button>}>
            Run a search, then press &ldquo;Save product&rdquo; on a result.
          </EmptyState>
        )}
        {products.data && products.data.length > 0 && (
          <ul className="grid gap-3 md:grid-cols-2">
            {products.data.map((p) => {
              const v = variantLabel(p.variant);
              return (
                <li key={p.id}>
                  <Link
                    href={`/saved/product?id=${encodeURIComponent(p.id)}`}
                    className="lift-3d flex min-h-11 gap-3 rounded-[1.1rem] border border-line bg-surface p-3 shadow-card hover:border-primary"
                  >
                    <ProductImage src={p.imageUrl ?? undefined} alt="" className="h-16 w-16 shrink-0" />
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="block font-display font-semibold leading-snug">{p.name}</span>
                      {v && <span className="block text-xs text-muted">{v}</span>}
                      <span className="block text-sm">
                        {p.lowestVerified ? <>Saved lowest verified <span className="tabular font-semibold">{rupees(p.lowestVerified.price)}</span> at {p.lowestVerified.retailer}</> : <span className="text-muted">Price not verified when saved</span>}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <span>Snapshot updated <time dateTime={p.updatedAt}>{relativeTime(p.updatedAt)}</time></span>
                        {p.monitor.enabled && <Badge tone="brand">Monitoring on</Badge>}
                        {p.devMock && <Badge tone="warn">Dev mock</Badge>}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="saved-reports-h" className="space-y-3">
        <h2 id="saved-reports-h" className="font-display text-xl font-extrabold tracking-tight">Research reports{reports.data ? ` (${reports.data.length})` : ""}</h2>
        {reports.isPending && !noIdb && <Skeleton className="h-20 w-full" />}
        {reports.isError && <ErrorState title="Could not read saved reports" message={(reports.error as Error).message} onRetry={() => reports.refetch()} />}
        {reports.data?.length === 0 && (
          <EmptyState icon={FileText} title="No saved research yet">
            On a search result, press &ldquo;Save research&rdquo; to keep the whole result as a report.
          </EmptyState>
        )}
        {reports.data && reports.data.length > 0 && (
          <ul className="space-y-2">
            {reports.data.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/saved/report?id=${encodeURIComponent(r.id)}`}
                  className="flex min-h-11 flex-col gap-1 rounded-[1.1rem] border border-line bg-surface p-3 hover:border-primary"
                >
                  <span className="font-display font-semibold break-words">&ldquo;{r.query}&rdquo;</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    <span>{intentLabel(r.intent)}</span>
                    <span aria-hidden>·</span>
                    <span>{r.groups.length} product{r.groups.length === 1 ? "" : "s"}</span>
                    <span aria-hidden>·</span>
                    <span>Researched {formatDate(r.generatedAt)}</span>
                    {r.previousId && <Badge tone="neutral">Refreshed version</Badge>}
                    {r.devMock && <Badge tone="warn">Dev mock</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

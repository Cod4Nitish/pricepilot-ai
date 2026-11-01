import type { RetailerStatus, RetailerStatusState } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

const LABEL: Record<RetailerStatusState, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  ok: { label: "OK", tone: "good" },
  partial: { label: "Partial", tone: "warn" },
  blocked: { label: "Blocked", tone: "bad" },
  login_required: { label: "Login required", tone: "warn" },
  no_results: { label: "No results", tone: "neutral" },
  error: { label: "Error", tone: "bad" },
  disabled: { label: "Disabled", tone: "neutral" },
};

export default function RetailerStatusBar({ statuses }: { statuses: RetailerStatus[] }) {
  if (statuses.length === 0) return null;
  return (
    <section aria-label="Retailer status">
      <h2 className="mb-2 text-sm font-semibold text-muted">Retailer status (this search)</h2>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {statuses.map((s) => {
          const l = LABEL[s.state];
          return (
            <li key={s.retailer} className="rounded-xl border border-line bg-surface p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{s.retailerName}</span>
                <Badge tone={l.tone}>{l.label}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted">{s.message}</p>
              <p className="mt-1 text-xs text-muted">
                {s.offerCount} offer{s.offerCount === 1 ? "" : "s"}
                {s.latencyMs !== undefined && ` · ${(s.latencyMs / 1000).toFixed(1)}s`}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

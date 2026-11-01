import { AlertTriangle, KeyRound } from "lucide-react";
import { ApiRequestError } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ErrorCard({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiRequestError ? error : null;
  if (e?.notConfigured) {
    return (
      <Card role="alert" className="border-warn/40">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden />
          <div className="space-y-1">
            <h3 className="font-display font-semibold">Server not configured yet</h3>
            <p className="text-sm text-muted">
              {e.message || "A required API key is missing."} For live product search, set <code className="rounded bg-surface2 px-1">TINYFISH_API_KEY</code> in the
              server environment and restart. No sample data is shown in the meantime.
            </p>
          </div>
        </div>
      </Card>
    );
  }
  return (
    <Card role="alert" className="border-bad/40">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-bad" aria-hidden />
        <div className="space-y-2">
          <h3 className="font-display font-semibold">Something went wrong</h3>
          <p className="text-sm text-muted">{error instanceof Error ? error.message : "Unknown error."}</p>
          {onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

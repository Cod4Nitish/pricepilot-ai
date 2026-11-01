"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, XCircle } from "lucide-react";
import { formatElapsed, type ShopStepStatus } from "@/lib/shop-client";
import { currentStage, displayLabel, isAgentStep, retailerOf, retailerStates, STAGE_LABEL, type MonitorStep } from "@/lib/research-monitor";
import { cn } from "@/lib/utils";

const STATUS_TEXT: Record<ShopStepStatus, string> = { ok: "OK", warn: "Warning", error: "Error" };

function StatusIcon({ status }: { status: ShopStepStatus }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" aria-hidden />;
  return <XCircle className="h-4 w-4 shrink-0 text-red-700" aria-hidden />;
}

function StepList({ steps }: { steps: MonitorStep[] }) {
  return (
    <ol className="space-y-1 text-sm text-[#0b1f4d]">
      {steps.map((s, i) => (
        <li key={`${s.at}-${i}`} className="flex items-start gap-2">
          <StatusIcon status={s.status} />
          <span className="min-w-0 flex-1 break-words">
            {displayLabel(s.label)}
            {s.status === "ok" ? (
              <span className="sr-only"> (OK)</span>
            ) : (
              <span className={cn("ml-1 text-xs font-semibold", s.status === "warn" ? "text-amber-800" : "text-red-700")}>{STATUS_TEXT[s.status]}</span>
            )}
            {isAgentStep(s.label) && retailerOf(s.label) && (
              <span className="block text-xs text-slate-600">Live browser preview: not available in this version</span>
            )}
          </span>
          <time className="tabular shrink-0 text-xs text-slate-600" dateTime={s.at}>{new Date(s.at).toLocaleTimeString()}</time>
        </li>
      ))}
    </ol>
  );
}

/** Live view of the REAL pipeline steps streamed from POST /api/shop. Indeterminate only, no percentages. */
export default function ResearchMonitor({ query, runId, steps, startedAt }: { query: string; runId: string | null; steps: MonitorStep[]; startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const stage = currentStage(steps);
  const chips = retailerStates(steps);
  const visible = steps.slice(-12);
  return (
    <section aria-labelledby="rm-title" className="rounded-xl border border-slate-200 bg-white p-4 text-[#0b1f4d] shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="rm-title" className="text-base font-semibold">Researching &ldquo;{query}&rdquo;</h2>
        <p className="text-sm">
          Elapsed <span className="tabular font-semibold">{formatElapsed(now - startedAt)}</span>
        </p>
      </div>
      <p className="mt-1 text-xs text-slate-600">
        Search ID: <span className="font-mono">{runId ?? "not assigned yet"}</span>
      </p>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-blue-100" aria-hidden>
        <div className="rm-indeterminate h-full w-1/3 rounded-full bg-[#1d4ed8]" />
      </div>
      <p role="status" aria-live="polite" className="mt-3 text-sm font-medium">
        {stage ? `Current stage: ${STAGE_LABEL[stage]}` : "Waiting for the first step from the server..."}
      </p>
      {chips.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Retailer status">
          {chips.map((c) => (
            <li
              key={c.retailer}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
                c.status === "ok" ? "border-emerald-300 bg-emerald-50" : c.status === "warn" ? "border-amber-300 bg-amber-50" : "border-red-300 bg-red-50",
              )}
            >
              <StatusIcon status={c.status} />
              <span className="font-semibold">{c.retailer}</span>
              <span>{c.agent && c.status === "ok" ? "Paid agent running" : STATUS_TEXT[c.status]}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        {visible.length ? (
          <StepList steps={visible} />
        ) : (
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <Circle className="h-4 w-4" aria-hidden /> No steps yet.
          </p>
        )}
        {steps.length > visible.length && (
          <p className="mt-1 text-xs text-slate-600">
            Showing the latest {visible.length} of {steps.length} steps.
          </p>
        )}
      </div>
    </section>
  );
}

/** Collapsed log of the same real steps, shown above results once the search finished. */
export function ResearchLog({ steps }: { steps: MonitorStep[] }) {
  if (!steps.length) return null;
  return (
    <details className="rounded-xl border border-slate-200 bg-white text-sm text-[#0b1f4d]">
      <summary className="flex min-h-11 cursor-pointer items-center px-3 font-medium">Research log ({steps.length} steps)</summary>
      <div className="border-t border-slate-200 px-3 py-2">
        <StepList steps={steps} />
        <p className="mt-2 text-xs text-slate-600">Source links for each offer are listed with the results below.</p>
      </div>
    </details>
  );
}

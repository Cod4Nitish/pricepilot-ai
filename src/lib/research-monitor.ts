// Pure derivations for the /shop Research Monitor. Everything here is derived ONLY from step
// labels that actually arrived from the server; nothing is predicted or invented.
import type { ShopStepStatus } from "./shop-client";

export interface MonitorStep {
  at: string;
  label: string;
  status: ShopStepStatus;
}

export const MONITOR_RETAILERS = ["Amazon.in", "Flipkart", "Croma", "Reliance Digital", "Vijay Sales"] as const;

export type Stage = "discovery" | "retailer search" | "fetch" | "agent" | "done";

export const STAGE_LABEL: Record<Stage, string> = {
  discovery: "Discovering products",
  "retailer search": "Searching retailers",
  fetch: "Reading retailer pages",
  agent: "Paid TinyFish Agent checking a price",
  done: "Done",
};

export function retailerOf(label: string): string | null {
  for (const r of MONITOR_RETAILERS) if (label.startsWith(`${r}:`) || label.includes(` ${r} `)) return r;
  return null;
}

export function isAgentStep(label: string): boolean {
  return /paid browser agent|: agent |^Agent /i.test(label);
}

export function stageOf(label: string): Stage | null {
  if (/^Done:/i.test(label) || /^Served from .*cache/i.test(label)) return "done";
  if (isAgentStep(label)) return "agent";
  if (/^Fetched |^Fetch failed|spec pages/i.test(label)) return "fetch";
  if (retailerOf(label) || /offer lookup|looking up verified/i.test(label)) return "retailer search";
  if (/discovery|candidates|query parsed|hard constraints|spec search/i.test(label)) return "discovery";
  return null;
}

/** Latest stage among arrived labels (null until a recognisable label arrives). */
export function currentStage(steps: MonitorStep[]): Stage | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = stageOf(steps[i].label);
    if (s) return s;
  }
  return null;
}

export type RetailerState = { retailer: string; status: ShopStepStatus; agent: boolean; last: string };

/** Per-retailer status from the most recent step naming that retailer. */
export function retailerStates(steps: MonitorStep[]): RetailerState[] {
  const m = new Map<string, RetailerState>();
  for (const s of steps) {
    const r = retailerOf(s.label);
    if (!r) continue;
    m.set(r, { retailer: r, status: s.status, agent: isAgentStep(s.label), last: s.label });
  }
  return MONITOR_RETAILERS.filter((r) => m.has(r)).map((r) => m.get(r)!);
}

/** Human display for a step: paid agent runs are named explicitly. */
export function displayLabel(label: string): string {
  const r = retailerOf(label);
  if (r && /using paid browser agent/i.test(label)) return `Paid TinyFish Agent running on ${r}`;
  return label;
}

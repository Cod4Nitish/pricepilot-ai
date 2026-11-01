import { randomUUID } from "node:crypto";
import type { AgentRun } from "./types";
import { saveRun } from "./supabase";

/** Small helper that records run steps (in memory always; Supabase when configured). */
export class RunTracker {
  run: AgentRun;
  constructor(kind: AgentRun["kind"], id: string = randomUUID()) {
    this.run = { id, kind, status: "running", steps: [], startedAt: new Date().toISOString() };
    void saveRun(this.run);
  }
  get id() {
    return this.run.id;
  }
  step(label: string, status: "ok" | "warn" | "error" = "ok"): void {
    this.run.steps.push({ at: new Date().toISOString(), label, status });
    void saveRun(this.run);
  }
  async finish(error?: string): Promise<void> {
    this.run.status = error ? "failed" : "completed";
    this.run.finishedAt = new Date().toISOString();
    if (error) this.run.error = error;
    await saveRun(this.run);
  }
}

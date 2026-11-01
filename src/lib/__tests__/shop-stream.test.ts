import { describe, expect, it } from "vitest";
import { parseNdjsonChunk } from "@/lib/shop-client";
import { currentStage, displayLabel, retailerStates } from "@/lib/research-monitor";

describe("parseNdjsonChunk", () => {
  it("parses complete lines and keeps the partial tail", () => {
    const a = parseNdjsonChunk("", '{"type":"start","runId":"r1","at":"t"}\n{"type":"step","at":"t","label":"Fl');
    expect(a.events).toEqual([{ type: "start", runId: "r1", at: "t" }]);
    const b = parseNdjsonChunk(a.rest, 'ipkart: search returned 3 results","status":"ok"}\n');
    expect(b.events).toHaveLength(1);
    expect(b.events[0]).toMatchObject({ type: "step", label: "Flipkart: search returned 3 results" });
    expect(b.rest).toBe("");
  });
  it("skips blank, malformed and untyped lines", () => {
    const r = parseNdjsonChunk("", '\n  \nnot json\n{"x":1}\n{"type":"result","data":{}}\n');
    expect(r.events).toEqual([{ type: "result", data: {} }]);
  });
});

describe("research monitor derivations", () => {
  const steps = [
    { at: "1", label: "Discovery search started (3 queries)", status: "ok" as const },
    { at: "2", label: "Amazon.in: search returned 5 results", status: "ok" as const },
    { at: "3", label: "Croma: search failed (timeout)", status: "error" as const },
    { at: "4", label: "Amazon.in: using paid browser agent for price", status: "ok" as const },
  ];
  it("derives stage and retailer chips only from arrived labels", () => {
    expect(currentStage([])).toBeNull();
    expect(currentStage(steps)).toBe("agent");
    expect(retailerStates(steps).map((r) => [r.retailer, r.status, r.agent])).toEqual([
      ["Amazon.in", "ok", true],
      ["Croma", "error", false],
    ]);
    expect(displayLabel(steps[3].label)).toBe("Paid TinyFish Agent running on Amazon.in");
  });
});

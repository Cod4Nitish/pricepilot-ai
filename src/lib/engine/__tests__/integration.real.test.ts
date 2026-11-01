// Real-network integration test. SKIPPED unless RUN_REAL_TESTS=1 (and TINYFISH_API_KEY is set in the environment).
// Calls the real search pipeline through the engine. Costs TinyFish credits; do not run in CI.
import { describe, expect, it } from "vitest";
import { defaultCollectors, runEngine } from "../orchestrator";

const enabled = process.env.RUN_REAL_TESTS === "1" && !!process.env.TINYFISH_API_KEY;

describe.skipIf(!enabled)("engine real integration", () => {
  it("answers an e-commerce request with honest statuses and no invented data", async () => {
    const res = await runEngine({ text: "iphone 15 128gb" }, { collectors: defaultCollectors(), cache: null });
    expect(res.perItem.length).toBe(1);
    expect(res.statuses.length).toBeGreaterThan(0);
    for (const o of res.perItem[0].offers) {
      expect(o.listedPrice === null || o.listedPrice > 0).toBe(true);
      expect(o.eligibleDiscount === null || o.eligibleDiscount >= 0).toBe(true);
    }
  }, 300_000);
});

import { describe, expect, it } from "vitest";
import { TtlCache } from "../../cache";
import { Limiter, TinyFishError } from "../../tinyfish";
import type { DeliveryInfo } from "../../shop/types";
import { checkDelivery, DeliveryInputError, interpretAgentResult, type DeliveryDeps } from "../check";
import { parseEta } from "../parse";

const D = new Date("2025-11-01T06:30:00.000Z"); // 12:00 IST, Saturday

describe("parseEta", () => {
  it("parses unambiguous dates", () => {
    expect(parseEta("Tomorrow, 2 Nov", D)).toEqual({ kind: "date", etaDate: "2025-11-02", etaDays: 1 });
    expect(parseEta("Delivery by Tue, 4 Nov", D)).toEqual({ kind: "date", etaDate: "2025-11-04", etaDays: 3 });
    expect(parseEta("Get it by Thursday, 6 November", D)).toEqual({ kind: "date", etaDate: "2025-11-06", etaDays: 5 });
    expect(parseEta("Tomorrow", D).etaDate).toBe("2025-11-02");
    expect(parseEta("Today", D).etaDays).toBe(0);
  });
  it("handles year rollover", () => {
    const dec = new Date("2025-12-30T06:30:00.000Z");
    expect(parseEta("Delivery by 2 Jan", dec).etaDate).toBe("2026-01-02");
  });
  it("refuses ambiguity", () => {
    expect(parseEta("3-5 business days", D)).toMatchObject({ kind: "ambiguous", etaDate: null, etaDays: null });
    expect(parseEta("Delivery by 4 - 6 Nov", D).etaDate).toBeNull();
    expect(parseEta("Get it by Thursday", D).etaDate).toBeNull();
    expect(parseEta("Delivery by Mon, 4 Nov", D).etaDate).toBeNull(); // weekday contradicts date
    expect(parseEta("", D).kind).toBe("none");
  });
  it("detects unserviceable", () => {
    expect(parseEta("Not deliverable to this pincode", D).kind).toBe("unserviceable");
    expect(parseEta("Currently, this item cannot be delivered to your location", D).kind).toBe("unserviceable");
  });
});

describe("checkDelivery", () => {
  const mk = (result: unknown, calls: string[] = []): Partial<DeliveryDeps> => ({
    runAgent: async ({ url, goal }) => {
      calls.push(url + "|" + goal);
      return { runId: "r", status: "COMPLETED", result };
    },
    now: () => D,
    cache: new TtlCache<DeliveryInfo>(60_000),
    limiter: new Limiter(3),
  });
  const offer = { offerId: "https://www.amazon.in/dp/B0CMDRCZBH", url: "https://www.amazon.in/dp/B0CMDRCZBH", retailer: "amazon" };

  it("rejects invalid pincodes", async () => {
    await expect(checkDelivery(offer, "12345", mk(null))).rejects.toBeInstanceOf(DeliveryInputError);
    await expect(checkDelivery(offer, "012345", mk(null))).rejects.toBeInstanceOf(DeliveryInputError);
  });
  it("published estimate with parsed date, never guaranteed, cached", async () => {
    const calls: string[] = [];
    const deps = mk({ serviceable: true, etaText: "Delivery by Tue, 4 Nov", message: null }, calls);
    const a = await checkDelivery(offer, "560001", deps);
    expect(a).toMatchObject({ kind: "published_estimate", serviceable: true, etaDate: "2025-11-04", etaDays: 3, guaranteed: false, pincode: "560001" });
    expect(calls[0]).toContain("560001");
    expect(calls[0]).toMatch(/never add to cart/i);
    await checkDelivery(offer, "560001", deps);
    expect(calls).toHaveLength(1);
  });
  it("unserviceable", async () => {
    const r = await checkDelivery(offer, "560001", mk({ serviceable: false, etaText: null, message: "Not deliverable to this pincode" }));
    expect(r).toMatchObject({ kind: "unserviceable", serviceable: false });
  });
  it("unsupported retailer is not_verified without calling the agent", async () => {
    const calls: string[] = [];
    const r = await checkDelivery({ offerId: "x", url: "https://www.croma.com/a/p/1", retailer: "croma" }, "560001", mk(null, calls));
    expect(r.kind).toBe("not_verified");
    expect(r.note).toBe("Pincode check not supported for croma yet.");
    expect(calls).toHaveLength(0);
  });
  it("blocked, failed and timed out runs are honest", async () => {
    expect(interpretAgentResult({ serviceable: null, etaText: null, message: "CAPTCHA appeared" }, "560001", D)).toMatchObject({ kind: "not_verified" });
    const failed = await checkDelivery(offer, "560001", { ...mk(null), runAgent: async () => ({ runId: "r", status: "FAILED", result: null, error: "boom" }) });
    expect(failed.kind).toBe("error");
    const timeout = await checkDelivery(offer, "560001", {
      ...mk(null),
      runAgent: async () => {
        throw new TinyFishError("timeout", "t");
      },
    });
    expect(timeout.kind).toBe("error");
    expect(timeout.note).toMatch(/timed out/);
    await expect(
      checkDelivery(offer, "560001", {
        ...mk(null),
        runAgent: async () => {
          throw new TinyFishError("insufficient_credits", "c");
        },
      }),
    ).rejects.toBeInstanceOf(TinyFishError);
  });
  it("estimate that cannot be reduced to a date keeps verbatim text and null date", async () => {
    const r = await checkDelivery(offer, "560001", mk({ serviceable: true, etaText: "3-5 business days", message: null }));
    expect(r).toMatchObject({ kind: "published_estimate", etaText: "3-5 business days", etaDate: null, etaDays: null });
  });
});

import { describe, expect, it, vi, afterEach } from "vitest";
import type { ProductGroup, ShopOffer, ShopResponse } from "@/lib/shop/types";
import { MOCK_SHOP_RESPONSE } from "@/app/shop/__mocks__/shop-mock";
import {
  applyRefresh,
  bestVerifiedPrice,
  buildSavedProduct,
  buildSavedReport,
  canClaimCheck,
  DIFFERENT_PRODUCT_MSG,
  dueForCheck,
  identityKey,
  mergeHistory,
  MONITOR_INTERVAL_MS,
  refreshQuery,
  reportSummaryText,
  safeHttpUrl,
  safeRetailerUrl,
  sanitizeGroup,
  targetHit,
  type SavedProduct,
} from "@/lib/saved/snapshot";

const NOW = new Date("2026-11-01T10:00:00.000Z");
const base = MOCK_SHOP_RESPONSE.groups[0];

function withOffers(g: ProductGroup, patch: (o: ShopOffer, i: number) => Partial<ShopOffer>): ProductGroup {
  return { ...g, offers: g.offers.map((o, i) => ({ ...o, ...patch(o, i) })) };
}
const res = (groups: ProductGroup[]): ShopResponse => ({ ...MOCK_SHOP_RESPONSE, groups });

afterEach(() => vi.restoreAllMocks());

describe("identityKey", () => {
  const v = { storageGb: 256, ramGb: 8, color: null, gpu: null, condition: "new" as const };
  it("normalises case/spacing and strips a repeated brand from the model", () => {
    expect(identityKey({ name: "x", brand: "Samsung", model: "Samsung  Galaxy S24", variant: v })).toBe(identityKey({ name: "y", brand: " SAMSUNG", model: "galaxy s24", variant: v }));
  });
  it("different storage, RAM or condition => different key", () => {
    const k = identityKey({ name: "", brand: "Samsung", model: "Galaxy S24", variant: v });
    expect(identityKey({ name: "", brand: "Samsung", model: "Galaxy S24", variant: { ...v, storageGb: 128 } })).not.toBe(k);
    expect(identityKey({ name: "", brand: "Samsung", model: "Galaxy S24", variant: { ...v, ramGb: 12 } })).not.toBe(k);
    expect(identityKey({ name: "", brand: "Samsung", model: "Galaxy S24", variant: { ...v, condition: "refurbished" } })).not.toBe(k);
    expect(identityKey({ name: "", brand: "Samsung", model: "Galaxy S24 Ultra", variant: v })).not.toBe(k);
  });
  it("includes gpu and colour when present; new and unknown condition share a key", () => {
    const k = identityKey({ name: "", brand: "Asus", model: "TUF A15", variant: { ...v, gpu: "RTX 4050", color: "Grey" } });
    expect(k).toContain("gpu rtx 4050");
    expect(k).toContain("colour grey");
    expect(identityKey({ name: "", brand: "A", model: "B", variant: { ...v, condition: "unknown" } })).toBe(identityKey({ name: "", brand: "A", model: "B", variant: v }));
  });
  it("falls back to the name when brand and model are missing", () => {
    expect(identityKey({ name: "Some  Phone", brand: null, model: null, variant: null })).toBe("some phone");
  });
});

describe("URL sanitizing", () => {
  it("http(s) only", () => {
    expect(safeHttpUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,x")).toBeNull();
    expect(safeHttpUrl("https://u:p@example.com")).toBeNull();
    expect(safeHttpUrl(42)).toBeNull();
  });
  it("retailer links must pass the SSRF allow-list", () => {
    expect(safeRetailerUrl("https://www.amazon.in/dp/B0CS5XW6TN?tag=x")).toBe("https://www.amazon.in/dp/B0CS5XW6TN");
    expect(safeRetailerUrl("https://example.com/mock/amazon/1")).toBeNull();
    expect(safeRetailerUrl("http://www.amazon.in/dp/B0CS5XW6TN")).toBeNull();
  });
});

describe("sanitizeGroup / buildSavedProduct", () => {
  it("keeps only allow-listed fields and drops invalid links (offer kept)", () => {
    const g = withOffers(base, (o, i) => (i === 0 ? { sourceUrl: "https://www.amazon.in/dp/B0CS5XW6TN", seller: "secret seller", apiKey: "sk-should-not-appear" } as Partial<ShopOffer> : {}));
    const g2 = { ...g, specs: [...g.specs, { key: "bad", label: "Bad", value: "x", sourceUrl: "javascript:alert(1)", evidence: "" }], authToken: "tok" } as ProductGroup;
    const s = sanitizeGroup(g2);
    expect(s.offers).toHaveLength(base.offers.length);
    expect(s.offers[0].sourceUrl).toBe("https://www.amazon.in/dp/B0CS5XW6TN");
    expect(s.offers[1].sourceUrl).toBeNull(); // example.com mock link dropped
    expect(s.specs.find((x) => x.key === "bad")).toBeUndefined();
    const json = JSON.stringify(s);
    expect(json).not.toContain("sk-should-not-appear");
    expect(json).not.toContain("secret seller");
    expect(json).not.toContain("authToken");
    expect(Object.keys(s.offers[0]).sort()).toEqual(["commerceMode", "delivery", "listedPrice", "observedAt", "productName", "retailer", "sourceUrl", "stockStatus", "trueCost", "verificationStatus"]);
  });

  it("keeps unknown as null (never 0)", () => {
    const g = withOffers(base, () => ({ listedPrice: null }));
    const s = sanitizeGroup(g);
    expect(s.offers.every((o) => o.listedPrice === null)).toBe(true);
    expect(bestVerifiedPrice(s.offers)).toBeNull();
  });

  it("history = real observations only; re-saving the same key updates and keeps savedAt + monitor", () => {
    const p1 = buildSavedProduct(base, MOCK_SHOP_RESPONSE, NOW);
    expect(p1.schemaVersion).toBe(1);
    expect(p1.id).toBe(p1.key);
    expect(p1.history).toHaveLength(base.offers.filter((o) => o.listedPrice !== null).length);
    const withMon: SavedProduct = { ...p1, monitor: { ...p1.monitor, enabled: true, targetPrice: 40000 } };
    const later = new Date(NOW.getTime() + 60_000);
    const p2 = buildSavedProduct(base, MOCK_SHOP_RESPONSE, later, withMon);
    expect(p2.savedAt).toBe(p1.savedAt);
    expect(p2.updatedAt).toBe(later.toISOString());
    expect(p2.monitor.targetPrice).toBe(40000);
    expect(p2.history).toHaveLength(p1.history.length); // same observations are not duplicated
  });

  it("devMock flag is carried only when set", () => {
    expect(buildSavedProduct(base, MOCK_SHOP_RESPONSE, NOW).devMock).toBeUndefined();
    expect(buildSavedProduct(base, MOCK_SHOP_RESPONSE, NOW, null, { devMock: true }).devMock).toBe(true);
  });
});

describe("refresh", () => {
  const saved = buildSavedProduct(base, MOCK_SHOP_RESPONSE, NOW);

  it("refreshQuery = clean name + variant bits not already in the name", () => {
    expect(refreshQuery({ name: "Samsung Galaxy S24 5G", variant: { storageGb: 256, ramGb: null, color: null, gpu: null, condition: "new" } })).toBe("Samsung Galaxy S24 5G 256GB");
    expect(refreshQuery({ name: "Samsung Galaxy S24 5G 256GB", variant: { storageGb: 256, ramGb: null, color: null, gpu: null, condition: "new" } })).toBe("Samsung Galaxy S24 5G 256GB");
    expect(refreshQuery({ name: "MacBook Air", variant: { storageGb: 1024, ramGb: 16, color: null, gpu: null, condition: "refurbished" } })).toBe("MacBook Air 16GB RAM 1TB refurbished");
  });

  it("updates only when the same identity is returned, and appends a new observation", () => {
    const newer = withOffers(base, (o, i) => (i === 0 ? { listedPrice: 43999, observedAt: "2026-11-01T11:00:00.000Z" } : {}));
    const out = applyRefresh(saved, res([newer]), new Date("2026-11-01T11:00:00.000Z"));
    expect(out.kind).toBe("updated");
    if (out.kind !== "updated") return;
    expect(out.added).toBe(1);
    expect(out.product.history.at(-1)).toMatchObject({ price: 43999, retailer: "Amazon" });
    expect(out.product.savedAt).toBe(saved.savedAt);
  });

  it("a different product (e.g. other storage) never changes the snapshot", () => {
    const other: ProductGroup = { ...base, variant: { ...base.variant, storageGb: 128 } };
    const out = applyRefresh(saved, res([other, MOCK_SHOP_RESPONSE.groups[1]]), NOW);
    expect(out).toEqual({ kind: "different", message: DIFFERENT_PRODUCT_MSG });
  });
});

describe("monitor rules", () => {
  const p = buildSavedProduct(base, MOCK_SHOP_RESPONSE, NOW);
  const on = (id: string, last: string | null): SavedProduct => ({ ...p, id, monitor: { ...p.monitor, enabled: true, lastCheckedAt: last } });
  const t = NOW.getTime();

  it("due = enabled and not checked in the last 6 h; capped; skip list honoured", () => {
    const list = [
      on("a", null),
      on("b", new Date(t - MONITOR_INTERVAL_MS - 1).toISOString()),
      on("c", new Date(t - 60_000).toISOString()), // checked a minute ago
      { ...on("d", null), monitor: { ...p.monitor, enabled: false } },
      on("e", null),
      on("f", null),
    ];
    expect(dueForCheck(list, t).map((x) => x.id)).toHaveLength(3);
    expect(dueForCheck(list, t, 10).map((x) => x.id).sort()).toEqual(["a", "b", "e", "f"]);
    expect(dueForCheck(list, t, 10, new Set(["a"])).map((x) => x.id)).not.toContain("a");
    expect(dueForCheck(list, t, 0)).toEqual([]);
  });

  it("claim is refused within the interval (cross-tab dedupe)", () => {
    expect(canClaimCheck(on("x", null), t)).toBe(true);
    expect(canClaimCheck(on("x", new Date(t - 1000).toISOString()), t)).toBe(false);
    expect(canClaimCheck({ ...on("x", null), monitor: { ...p.monitor, enabled: false } }, t)).toBe(false);
  });

  it("target hit only for a verified price at or below a set target", () => {
    expect(targetHit(45000, { price: 44999 })).toBe(true);
    expect(targetHit(45000, { price: 45000 })).toBe(true);
    expect(targetHit(45000, { price: 45001 })).toBe(false);
    expect(targetHit(null, { price: 1 })).toBe(false);
    expect(targetHit(45000, null)).toBe(false);
    const unverified = sanitizeGroup(withOffers(base, () => ({ verificationStatus: "snippet_only" as const })));
    expect(bestVerifiedPrice(unverified.offers)).toBeNull();
  });

  it("mergeHistory de-duplicates and sorts", () => {
    const a = { at: "2026-11-01T10:00:00Z", retailer: "Amazon", price: 1, verificationStatus: "verified" as const };
    const b = { ...a, at: "2026-10-01T10:00:00Z" };
    expect(mergeHistory([a], [a, b])).toEqual([b, a]);
  });
});

describe("reports", () => {
  it("builds a sanitized report and a plain-text summary, without any network call", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = buildSavedReport(MOCK_SHOP_RESPONSE, NOW, "r-1");
    expect(r.schemaVersion).toBe(1);
    expect(r.groups).toHaveLength(2);
    expect(r.sourcesChecked.map((s) => s.source)).toContain("croma");
    expect(r.researchCost?.paidAgentSteps).toBe(18);
    expect(r.budgetMax).toBe(50000);
    expect(r.previousId).toBeNull();
    const text = reportSummaryText(r);
    expect(text).toContain("Saved snapshot: prices may be outdated");
    expect(text).toContain("Rs 44,999");
    expect(text).not.toMatch(/\blive\b/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

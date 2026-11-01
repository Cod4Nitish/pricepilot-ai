// DEV/TEST ONLY FIXTURE. Never imported on production code paths:
// ShopView loads it via dynamic import behind `process.env.NODE_ENV !== "production"` and `?mock=1`.
// All names/prices here are invented for layout testing and are clearly labelled "MOCK".
import type { DeliveryInfo, ProductGroup, ShopOffer, ShopResponse } from "@/lib/shop/types";

const NOW = Date.now();
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

const notVerified: DeliveryInfo = { pincode: null, serviceable: null, kind: "not_verified", etaText: null, etaDate: null, etaDays: null, guaranteed: false, checkedAt: null, evidence: null, note: null };

const variant = { storageGb: 256, ramGb: 8, color: null, gpu: null, screenInch: null, condition: "new" as const };

function offer(over: Partial<ShopOffer> & { retailer: string; sourceUrl: string; listedPrice: number | null }): ShopOffer {
  return {
    productId: "mock-1", productName: "MOCK Phone One 5G", brand: "Mockbrand",
    variant: { storageGb: 256, ramGb: 8, color: "Black", size: null, condition: "new", pack: null },
    unitQuantity: null, commerceMode: "ecommerce", locationId: null, mrp: null, shippingFee: null, handlingFee: null, platformFee: null,
    eligibleDiscount: null, conditionalDiscounts: [], stockStatus: "in_stock", deliveryEtaMinutes: null, observedAt: iso(12),
    verificationStatus: "verified", matchingConfidence: 0.93,
    evidence: [{ text: "MOCK Phone One 5G (8GB RAM, 256GB) Rs 44,999", source: over.sourceUrl }],
    imageUrl: null, discountPct: null, seller: null, warranty: null, returnPolicy: null, conditionalOffers: [], effectiveTotal: null, totalIsLowerBound: false,
    delivery: notVerified,
    ...over,
  };
}

const offers1: ShopOffer[] = [
  offer({
    retailer: "Amazon", sourceUrl: "https://example.com/mock/amazon/1", listedPrice: 44999, mrp: 54999, discountPct: 18, shippingFee: 0, effectiveTotal: 44999,
    seller: "MOCK Retail Pvt Ltd", warranty: "1 year manufacturer warranty", returnPolicy: "10 days replacement",
    conditionalOffers: [{ text: "Rs 3,000 off with HDFC credit card", amount: 3000, condition: "HDFC credit card", applied: false }],
    productName: "MOCK Phone One 5G (8GB RAM, 256GB, Black)", observedAt: iso(4),
  }),
  offer({
    retailer: "Flipkart", sourceUrl: "https://example.com/mock/flipkart/1", listedPrice: 45499, mrp: 54999, discountPct: 17, shippingFee: 40, effectiveTotal: 45539,
    seller: "MOCK Seller", warranty: null, returnPolicy: null, verificationStatus: "agent_verified", observedAt: iso(95),
    delivery: { pincode: "400001", serviceable: true, kind: "published_estimate", etaText: "Delivery by Tue, 4 Nov", etaDate: "2026-11-04", etaDays: 3, guaranteed: false, checkedAt: iso(2), evidence: "Delivery by Tue, 4 Nov", note: null },
  }),
  offer({
    retailer: "Croma", sourceUrl: "https://example.com/mock/croma/1", listedPrice: 46990, shippingFee: null, effectiveTotal: null, totalIsLowerBound: true,
    stockStatus: "unknown", observedAt: iso(2000),
    delivery: { pincode: "400001", serviceable: false, kind: "unserviceable", etaText: null, etaDate: null, etaDays: null, guaranteed: false, checkedAt: iso(2), evidence: null, note: "Retailer says this pincode is not serviceable." },
  }),
];

const g1: ProductGroup = {
  id: "mock-g1", name: "MOCK Phone One 5G 256GB", brand: "Mockbrand", model: "Phone One", variant, imageUrl: null,
  specs: [
    { key: "chipset", label: "Chipset", value: "Mock Chip 9", sourceUrl: "https://example.com/mock/spec/1", evidence: "Mock Chip 9" },
    { key: "ram_gb", label: "RAM", value: 8, unit: "GB", sourceUrl: "https://example.com/mock/spec/1", evidence: "8GB RAM" },
    { key: "storage_gb", label: "Storage", value: 256, unit: "GB", sourceUrl: "https://example.com/mock/spec/1", evidence: "256GB" },
    { key: "battery_mah", label: "Battery", value: 5000, unit: "mAh", sourceUrl: "https://example.com/mock/spec/2", evidence: "5000 mAh" },
    { key: "display", label: "Display", value: "6.7 in AMOLED 120Hz", sourceUrl: "https://example.com/mock/spec/2", evidence: "6.7 inch AMOLED" },
  ],
  score: {
    total: 78,
    components: [
      { name: "performance", score: 0.84, weight: 0.3, basis: "Chipset benchmark class from listed spec" },
      { name: "camera", score: null, weight: 0.25, basis: "No camera evidence found" },
      { name: "battery", score: 0.7, weight: 0.2, basis: "5000 mAh listed" },
      { name: "price", score: 0.8, weight: 0.25, basis: "Within budget" },
    ],
    provisional: true, missing: ["camera sensor", "software update policy"],
  },
  why: ["Fits the Rs 50,000 budget with a verified price", "Large battery and 120Hz AMOLED display listed on the product page"],
  offers: offers1,
  decision: {
    cheapestListed: { offerId: offers1[0].sourceUrl, retailer: "Amazon", value: 44999, reasons: ["Lowest listed price among 3 verified offers"], conditions: [], evidence: ["https://example.com/mock/amazon/1"] },
    cheapestPayable: { offerId: offers1[0].sourceUrl, retailer: "Amazon", value: 44999, reasons: ["Shipping is free and no other fees were found"], conditions: ["Bank offer not applied"], evidence: ["Free delivery"] },
    fastest: { offerId: offers1[1].sourceUrl, retailer: "Flipkart", value: "Delivery by Tue, 4 Nov", reasons: ["Only store with a published ETA to 400001"], conditions: ["Estimate, not guaranteed"], evidence: ["Delivery by Tue, 4 Nov"] },
    bestOverall: null,
    notes: ["Best overall: not enough verified data (delivery known for 1 of 3 stores).", "Croma: shipping unknown, so no payable total."],
    singleStoreOnly: false,
  },
  lowestVerified: { price: 44999, retailer: "Amazon" }, comparable: true, provisional: true, rank: 1,
};

const g2: ProductGroup = {
  id: "mock-g2", name: "MOCK Phone Two 5G 256GB", brand: "Mockbrand", model: "Phone Two", variant, imageUrl: null,
  specs: [{ key: "ram_gb", label: "RAM", value: 12, unit: "GB", sourceUrl: "https://example.com/mock/spec/3", evidence: "12GB" }],
  score: { total: null, components: [{ name: "performance", score: null, weight: 0.5, basis: "No evidence" }], provisional: true, missing: ["chipset", "battery"] },
  why: [],
  offers: [offer({ retailer: "Reliance Digital", sourceUrl: "https://example.com/mock/rd/2", listedPrice: 39999, productName: "MOCK Phone Two 5G" })],
  decision: { cheapestListed: null, cheapestPayable: null, fastest: null, bestOverall: null, notes: ["Only one verified store offer was found."], singleStoreOnly: true },
  lowestVerified: null, comparable: false, provisional: true, rank: 2,
};

export const MOCK_SHOP_RESPONSE: ShopResponse = {
  parsed: {
    raw: "best fone under 50k galaxy s24", normalized: "best phone under 50000 galaxy s24", searchIntent: "PRODUCT_RECOMMENDATION", category: "smartphone",
    brand: null, model: null, variant, budgetMin: null, budgetMax: 50000, preferredFeatures: ["camera", "battery"], excludedFeatures: [],
    deliveryPincode: "400001", sortPreference: null, comparisonTargets: [], url: null, language: "hinglish",
    corrections: [{ from: "fone", to: "phone" }, { from: "galaxy s24", to: "galaxy s24" }], source: "deterministic", confidence: 0.82,
  },
  groups: [g1, g2],
  statuses: [
    { source: "amazon", state: "ok", message: "3 results" },
    { source: "croma", state: "blocked", message: "could not read price" },
    { source: "delivery:flipkart", state: "timeout", message: "pincode check timed out" },
  ],
  recommendationProvisional: true,
  summary: "MOCK DATA for layout testing only. Two candidates found; evidence is incomplete for one.",
  emptyReason: null,
  weights: { price: 0.5, delivery: 0.25, evidence: 0.25 },
  runId: "mock-run", generatedAt: iso(1), cached: false,
};

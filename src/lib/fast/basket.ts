import { samePack } from "./pack";
import type { BasketLine, Comparison, ProviderResult, SplitPlan, StoreBasket, StoreBasketLine, TotalKind } from "./types";

const inr = (n: number) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Math.round(n * 100) / 100)}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

const COMPONENTS: { key: "delivery" | "handling" | "platform" | "discount"; label: string }[] = [
  { key: "delivery", label: "delivery fee" },
  { key: "handling", label: "handling fee" },
  { key: "platform", label: "platform fee" },
  { key: "discount", label: "discount" },
];

/** Compute one store's basket. Unknown fee components are never guessed or included. */
export function buildStoreBasket(result: ProviderResult, lines: BasketLine[]): StoreBasket {
  const byQuery = new Map(result.lines.map((l) => [l.query.toLowerCase().trim(), l]));
  const sbLines: StoreBasketLine[] = lines.map((l) => {
    const r = byQuery.get(l.query.toLowerCase().trim());
    const offer = r?.resolution === "found" ? r.offer : null;
    const price = offer?.price ?? null;
    return {
      query: l.query,
      qty: l.qty,
      resolution: r?.resolution ?? "not_checked",
      offer,
      lineTotal: price !== null ? round2(price * l.qty) : null,
      note: r?.note ?? "Not checked.",
    };
  });
  const found = sbLines.filter((l) => l.lineTotal !== null);
  const missing = sbLines.filter((l) => l.lineTotal === null).map((l) => l.query);
  const usable = result.state === "ok" || result.state === "partial";
  const itemsTotal = usable && found.length ? round2(found.reduce((s, l) => s + (l.lineTotal ?? 0), 0)) : null;
  const complete = usable && missing.length === 0 && sbLines.length > 0;

  const unknownComponents = COMPONENTS.filter((c) => result.fees[c.key] === null).map((c) => c.label);
  const f = result.fees;
  const knownFeesTotal = round2((f.delivery ?? 0) + (f.handling ?? 0) + (f.platform ?? 0) - (f.discount ?? 0));
  const total = itemsTotal === null ? null : round2(Math.max(0, itemsTotal + knownFeesTotal));

  let totalKind: TotalKind;
  let totalLabel: string;
  if (total === null) {
    totalKind = "unavailable";
    totalLabel = result.state === "ok" || result.state === "partial" ? "No items found" : `Unavailable: ${result.reason}`;
  } else if (complete && unknownComponents.length === 0) {
    totalKind = "verified";
    totalLabel = "Verified total";
  } else {
    totalKind = "estimated";
    totalLabel = complete
      ? "Estimated (excludes unknown fees)"
      : `Partial estimate (${missing.length} item${missing.length === 1 ? "" : "s"} missing; excludes unknown fees)`;
  }

  return {
    providerId: result.providerId,
    providerName: result.providerName,
    state: result.state,
    reason: result.reason,
    lines: sbLines,
    missing,
    complete,
    itemsTotal,
    fees: result.fees,
    unknownComponents,
    knownFeesTotal,
    total,
    totalKind,
    totalLabel,
    etaText: result.etaText,
    etaMinutes: result.etaMinutes,
    homeUrl: result.homeUrl,
  };
}

/** For every query, all stores' matched packs must be parsed and identical, else prices are not like-for-like. */
export function comparabilityIssues(baskets: StoreBasket[], lines: BasketLine[]): string[] {
  const issues: string[] = [];
  for (const l of lines) {
    const offers = baskets.map((b) => b.lines.find((x) => x.query === l.query)?.offer).filter((o): o is NonNullable<typeof o> => !!o);
    if (offers.length < 2) continue;
    if (offers.some((o) => !o.pack)) issues.push(`"${l.query}": pack size not stated on every store, so prices may not be like-for-like.`);
    else if (!offers.every((o) => samePack(o.pack, offers[0].pack))) issues.push(`"${l.query}": stores matched different pack sizes (${offers.map((o) => o.pack?.label).join(" vs ")}). Add the size to the item name.`);
  }
  return issues;
}

/** Split the basket across stores, item by item. Recommended only if it still saves money after known fees. */
export function buildSplit(baskets: StoreBasket[], lines: BasketLine[], baseline: StoreBasket | null): SplitPlan | null {
  const usable = baskets.filter((b) => b.state === "ok" || b.state === "partial");
  if (usable.length < 2) return null;
  const assignments: SplitPlan["assignments"] = [];
  for (const l of lines) {
    let best: { b: StoreBasket; total: number } | null = null;
    for (const b of usable) {
      const sl = b.lines.find((x) => x.query === l.query);
      if (sl?.lineTotal != null && (!best || sl.lineTotal < best.total)) best = { b, total: sl.lineTotal };
    }
    if (!best) return null; // some item is available nowhere; a split cannot complete the basket
    assignments.push({ query: l.query, providerId: best.b.providerId, providerName: best.b.providerName, lineTotal: best.total });
  }
  const used = [...new Set(assignments.map((a) => a.providerId))];
  if (used.length < 2) return null;
  const perStore = used.map((id) => {
    const b = usable.find((x) => x.providerId === id)!;
    const itemsTotal = round2(assignments.filter((a) => a.providerId === id).reduce((s, a) => s + a.lineTotal, 0));
    return { providerId: id, providerName: b.providerName, itemsTotal, knownFees: b.knownFeesTotal, unknownComponents: b.unknownComponents };
  });
  const total = round2(perStore.reduce((s, p) => s + p.itemsTotal + p.knownFees, 0));
  const allKnown = perStore.every((p) => p.unknownComponents.length === 0);
  const totalKind: TotalKind = allKnown ? "verified" : "estimated";
  if (!baseline || baseline.total === null) {
    return { recommended: false, assignments, perStore, total, totalKind, savings: 0, reason: "No single store can supply the whole basket, so there is nothing to compare a split against. Splitting is the only way to cover everything." };
  }
  const savings = round2(baseline.total - total);
  const recommended = savings > 0;
  return {
    recommended,
    assignments,
    perStore,
    total,
    totalKind,
    savings: recommended ? savings : 0,
    reason: recommended
      ? `Buying each item where it is cheapest saves ${inr(savings)} versus ${baseline.providerName} alone, after the fees we could verify.${allKnown && baseline.unknownComponents.length === 0 ? "" : " Some fees are unknown and not included, so the real saving may differ."}`
      : `Splitting would not save money (${inr(total)} vs ${inr(baseline.total)} at ${baseline.providerName}) once known fees are counted.`,
  };
}

/** Compare store baskets: cheapest complete basket, fastest published ETA, optional split, plain-language summary. */
export function compareBaskets(baskets: StoreBasket[], lines: BasketLine[]): Comparison {
  const issues = comparabilityIssues(baskets, lines);
  const complete = baskets.filter((b) => b.complete && b.total !== null).sort((a, b) => a.total! - b.total!);

  let winner: Comparison["winner"] = null;
  let noWinnerReason: string | null = null;
  if (complete.length < 2) {
    noWinnerReason =
      complete.length === 1
        ? `Only ${complete[0].providerName} could supply every item, so there is no like-for-like comparison to declare a cheapest cart.`
        : "No store could supply every item with verified prices, so no cheapest cart is declared.";
  } else if (issues.length) {
    noWinnerReason = "Pack sizes could not be matched exactly across stores, so a winner would not be fair. " + issues[0];
  } else if (complete[0].total === complete[1].total) {
    noWinnerReason = `${complete[0].providerName} and ${complete[1].providerName} cost the same on the data we could verify.`;
  } else {
    const [w, second] = complete;
    const kind: TotalKind = complete.every((b) => b.totalKind === "verified") ? "verified" : "estimated";
    const savings = round2(second.total! - w.total!);
    const why = [
      `${w.providerName} has every item in stock at this pincode for ${inr(w.total!)}, versus ${inr(second.total!)} at ${second.providerName}.`,
      `Exact pack sizes matched across stores for all ${lines.length} item${lines.length === 1 ? "" : "s"}.`,
    ];
    if (kind === "estimated") {
      const unk = [...new Set(complete.flatMap((b) => b.unknownComponents))];
      why.push(`Totals are estimates: ${unk.join(", ")} could not be verified on the page and are not included, so a small gap could change.`);
    } else why.push("All fee components were verified on the page.");
    winner = { providerId: w.providerId, providerName: w.providerName, total: w.total!, kind, savings, vsProviderName: second.providerName, why };
  }

  // fastest: published ETA only, need at least two comparable published ETAs
  const withEta = baskets.filter((b) => (b.state === "ok" || b.state === "partial") && b.etaMinutes !== null && b.etaText);
  let fastest: Comparison["fastest"] = null;
  let fastestNote: string | null = null;
  if (withEta.length < 2) {
    fastestNote = withEta.length === 1 ? `Only ${withEta[0].providerName} published a delivery time we could read; no fastest claim.` : "No readable delivery times were published, so no fastest option is named.";
  } else {
    const s = [...withEta].sort((a, b) => a.etaMinutes! - b.etaMinutes!);
    if (s[0].etaMinutes === s[1].etaMinutes) fastestNote = "Delivery times published are equal.";
    else fastest = { providerId: s[0].providerId, providerName: s[0].providerName, etaText: s[0].etaText!, etaMinutes: s[0].etaMinutes! };
  }

  const baseline = winner ? (complete.find((b) => b.providerId === winner!.providerId) ?? null) : (complete[0] ?? null);
  const split = issues.length ? null : buildSplit(baskets, lines, baseline);

  const reasons: string[] = [];
  let text: string;
  if (winner) {
    text = `${winner.providerName} is the best overall: cheapest complete cart${winner.kind === "verified" ? "" : " (estimated)"} at ${inr(winner.total)}.`;
    reasons.push(...winner.why);
    if (fastest && fastest.providerId !== winner.providerId) {
      const wb = baskets.find((b) => b.providerId === winner!.providerId);
      reasons.push(
        `${fastest.providerName} publishes a faster delivery time (${fastest.etaText})${wb?.etaText ? ` than ${wb.providerName} (${wb.etaText})` : ""} but costs more on this basket. Pick it if speed matters more than the ${inr(winner.savings)} difference.`,
      );
    } else if (fastest) reasons.push(`It also publishes the fastest delivery time (${fastest.etaText}).`);
    if (split?.recommended) reasons.push(`Splitting the basket could save a further ${inr(split.savings)} (see split plan).`);
  } else {
    text = "No overall winner can be named yet.";
    if (noWinnerReason) reasons.push(noWinnerReason);
    for (const b of baskets) if (b.totalKind === "unavailable") reasons.push(`${b.providerName}: unavailable: ${b.reason || "no data"}.`);
    if (fastest) reasons.push(`${fastest.providerName} publishes the fastest delivery time (${fastest.etaText}).`);
  }
  return { winner, noWinnerReason, fastest, fastestNote, split, bestOverall: { text, reasons }, comparabilityIssues: issues };
}

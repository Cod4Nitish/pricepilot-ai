// Deterministic parsing of retailer delivery text. A date is produced ONLY when it is unambiguous.

export interface ParsedEta {
  kind: "date" | "unserviceable" | "ambiguous" | "none";
  etaDate: string | null; // ISO yyyy-mm-dd
  etaDays: number | null; // whole calendar days from the checked date (IST)
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_MS = 86_400_000;

const UNSERVICEABLE = /not\s+deliverable|cannot\s+be\s+delivered|can'?t\s+be\s+delivered|not\s+serviceable|unserviceable|(?:do(?:es)?\s+not|doesn'?t|don'?t)\s+deliver|delivery\s+not\s+available|not\s+available\s+(?:for|at)\s+(?:this\s+)?(?:pin|delivery)|currently\s+unavailable\s+for\s+delivery|no\s+delivery/i;

/** Calendar date (UTC midnight of the IST calendar day) of `d`. */
function istDay(d: Date): number {
  const t = d.getTime() + 330 * 60_000;
  return Math.floor(t / DAY_MS) * DAY_MS;
}
const iso = (dayMs: number) => new Date(dayMs).toISOString().slice(0, 10);

export function parseEta(text: string | null | undefined, checkedAt: Date): ParsedEta {
  const none: ParsedEta = { kind: "none", etaDate: null, etaDays: null };
  if (!text || !text.trim()) return none;
  const t = text.replace(/\s+/g, " ").trim();
  if (UNSERVICEABLE.test(t)) return { kind: "unserviceable", etaDate: null, etaDays: null };
  const today = istDay(checkedAt);
  const done = (dayMs: number): ParsedEta => ({ kind: "date", etaDate: iso(dayMs), etaDays: Math.round((dayMs - today) / DAY_MS) });
  const amb: ParsedEta = { kind: "ambiguous", etaDate: null, etaDays: null };

  // ranges ("3-5 business days", "4 - 6 Nov", "between 3 and 5 days") are ambiguous: no date
  if (/\b\d+\s*(?:-|to|–)\s*\d+\s*(?:business\s+|working\s+)?days?\b/i.test(t) || /\b\d{1,2}\s*(?:-|to|–)\s*\d{1,2}\s*(?:st|nd|rd|th)?\s+[a-z]{3,}/i.test(t)) return amb;
  if (/\bbusiness\s+days?\b|\bworking\s+days?\b/i.test(t)) return amb;

  // explicit date: "2 Nov", "4th November", "November 6"
  const monthRe = "(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*";
  const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${monthRe}\\b`, "i").exec(t);
  const md = new RegExp(`\\b${monthRe}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i").exec(t);
  let day: number | null = null;
  let month: number | null = null;
  if (dm) {
    day = Number(dm[1]);
    month = MONTHS[dm[2].toLowerCase()];
  } else if (md) {
    day = Number(md[2]);
    month = MONTHS[md[1].toLowerCase()];
  }
  if (day !== null && month !== null && month !== undefined && day >= 1 && day <= 31) {
    const wk = new RegExp(`\\b(${WEEKDAYS.join("|")})[a-z]*\\b`, "i").exec(t)?.[1]?.toLowerCase().slice(0, 3);
    const y0 = new Date(today).getUTCFullYear();
    // pick the first year (this or next) where the date is not in the past (1 day grace) -> year rollover
    for (const y of [y0, y0 + 1]) {
      const cand: number = Date.UTC(y, month, day);
      if (new Date(cand).getUTCMonth() !== month) return amb; // e.g. 31 Nov
      if (cand >= today - DAY_MS) {
        if (wk && WEEKDAYS[new Date(cand).getUTCDay()] !== wk) return amb; // weekday contradicts date
        return done(cand);
      }
    }
    return amb;
  }

  // relative words
  if (/\btoday\b/i.test(t)) return done(today);
  if (/\btomorrow\b/i.test(t)) return done(today + DAY_MS);
  const rel = /\b(?:in|within)\s+(\d{1,2})\s+days?\b/i.exec(t);
  if (rel && !/\b(?:to|-)\b/.test(rel[0])) return done(today + Number(rel[1]) * DAY_MS);
  // weekday only ("Thursday"): not a date
  if (new RegExp(`\\b(${WEEKDAYS.join("|")})[a-z]*\\b`, "i").test(t) || /\b\d+\s*days?\b/i.test(t)) return amb;
  return none;
}

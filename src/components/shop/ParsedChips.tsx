import { Pencil } from "lucide-react";
import type { ParsedQuery } from "@/lib/shop/types";
import { budgetLabel, categoryLabel, intentLabel } from "@/lib/shop-client";

const LANG = { en: "English", hi: "Hindi", hinglish: "Hinglish" } as const;

export default function ParsedChips({ parsed, pin, onEdit }: { parsed: ParsedQuery; pin: string | null; onEdit: () => void }) {
  const real = parsed.corrections.filter((c) => c.from.toLowerCase() !== c.to.toLowerCase());
  const budget = budgetLabel(parsed.budgetMin, parsed.budgetMax);
  const chips: string[] = [
    `Intent: ${intentLabel(parsed.searchIntent)}`,
    parsed.category !== "other" ? categoryLabel(parsed.category) : null,
    parsed.brand,
    budget,
    ...parsed.preferredFeatures,
    ...parsed.excludedFeatures.map((f) => `Not ${f}`),
    pin ? `Pincode ${pin}` : null,
    parsed.language !== "en" ? `Language: ${LANG[parsed.language]}` : null,
  ].filter((c): c is string => !!c);

  return (
    <section aria-label="How we understood your search" className="space-y-2">
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {chips.map((c) => (
          <span key={c} className="shrink-0 rounded-full border border-line-strong bg-surface px-3 py-1.5 text-xs font-semibold">{c}</span>
        ))}
        <button type="button" onClick={onEdit} className="chip-3d inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line-strong bg-surface2 px-4 text-xs font-semibold">
          <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
        </button>
      </div>
      {real.length > 0 && (
        <p className="text-sm text-muted">
          {real.map((c, i) => (
            <span key={i}>
              {i > 0 && "; "}we searched for <span className="font-semibold text-fg">{c.to}</span> (you typed &ldquo;{c.from}&rdquo;)
            </span>
          ))}
        </p>
      )}
      {parsed.normalized && parsed.normalized.toLowerCase() !== parsed.raw.toLowerCase() && real.length === 0 && (
        <p className="text-sm text-muted">Interpreted as: <span className="font-semibold text-fg">{parsed.normalized}</span></p>
      )}
    </section>
  );
}

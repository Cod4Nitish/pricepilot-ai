import Link from "next/link";
import SmartSearch from "./SmartSearch";
import HeroIllustration from "@/components/home/HeroIllustration";

const EXAMPLES = ["Samsung Galaxy S24 256GB", "Best phone under ₹50K", "Gaming laptop under ₹70K"];

/** Search-first hero: plain headline, one-line subtitle, the search box and example chips. */
export default function HeroSearch() {
  return (
    <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-10">
    <div className="mx-auto w-full max-w-3xl min-w-0 text-center lg:text-left">
      <p className="eyebrow">Your AI shopping copilot</p>
      <h1 className="mt-2 text-display font-semibold text-balance">Find better deals. Spend less. Decide better.</h1>
      <p className="mx-auto mt-3 max-w-2xl text-body lg:mx-0 text-muted">
        One intelligent search. Real retailer evidence. Smarter buying decisions.
      </p>
      <div className="mt-6 text-left">
        <SmartSearch variant="hero" inputId="hero-search" />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
        <span className="text-sm text-muted">Try:</span>
        {EXAMPLES.map((ex) => (
          <Link
            key={ex}
            href={`/shop?q=${encodeURIComponent(ex)}`}
            className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-3 text-sm hover:border-primary hover:text-primary"
          >
            {ex}
          </Link>
        ))}
      </div>
    </div>
    <HeroIllustration className="mx-auto h-auto w-full max-w-[280px] sm:max-w-[340px] lg:max-w-[440px]" />
    </div>
  );
}

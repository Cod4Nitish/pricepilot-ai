import Link from "next/link";
import SmartSearch from "./SmartSearch";

const EXAMPLES = ["iPhone 15 128GB", "Sony WH-1000XM5", "boAt Airdopes 141", "Samsung 43 inch smart TV"];

/** Search-first hero: plain headline, one-line subtitle, the search box and example chips. */
export default function HeroSearch() {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <h1 className="text-display font-semibold text-balance">Compare prices across Indian stores</h1>
      <p className="mx-auto mt-3 max-w-2xl text-body text-muted">
        Search by name or speak. We check online stores and quick-delivery apps and show how every price was verified.
      </p>
      <div className="mt-6 text-left">
        <SmartSearch variant="hero" inputId="hero-search" />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <span className="text-sm text-muted">Try:</span>
        {EXAMPLES.map((ex) => (
          <Link
            key={ex}
            href={`/discover?q=${encodeURIComponent(ex)}`}
            className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-3 text-sm hover:border-primary hover:text-primary"
          >
            {ex}
          </Link>
        ))}
      </div>
    </div>
  );
}

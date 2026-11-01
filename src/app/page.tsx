import Link from "next/link";
import HeroSearch from "@/components/layout/HeroSearch";

const STEPS = [
  { title: "Search", text: "Type a product name, speak it, or paste a product link." },
  { title: "We check stores", text: "We read price, delivery and stock from retailer pages and quick-delivery apps." },
  { title: "Compare", text: "See the best verified price and the evidence behind it." },
];

const LABELS = [
  { name: "Verified", tone: "text-good", text: "Price read from the retailer product page. Eligible for best verified." },
  { name: "Agent verified", tone: "text-primary", text: "Read by a web agent on the live page. Eligible for best verified." },
  { name: "Snippet only", tone: "text-warn", text: "Seen in a search snippet; the page was not confirmed. Never used for best." },
  { name: "Unverified", tone: "text-muted", text: "Could not be confirmed. Shown for transparency only." },
];

const RETAILERS = ["Amazon India", "Flipkart", "Croma", "Reliance Digital", "Vijay Sales"];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-[1100px] space-y-14 sm:space-y-16">
      <section aria-label="Search" className="pt-2 sm:pt-8">
        <HeroSearch />
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="mb-4 text-h2 font-semibold">How it works</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-xl border border-line bg-surface p-4">
              <p className="tabular text-sm font-medium text-muted">Step {i + 1}</p>
              <h3 className="mt-1 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="labels">
        <h2 id="labels" className="mb-4 text-h2 font-semibold">How we label prices</h2>
        <dl className="divide-y divide-line rounded-xl border border-line bg-surface">
          {LABELS.map((l) => (
            <div key={l.name} className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
              <dt className={`font-semibold ${l.tone}`}>{l.name}</dt>
              <dd className="text-sm text-muted">{l.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="retailers">
        <h2 id="retailers" className="mb-2 text-h2 font-semibold">Stores we check</h2>
        <p className="text-sm text-muted">
          {RETAILERS.join(", ")}, and quick-delivery apps where available. Each store&apos;s status is checked on every search and shown to you.
        </p>
      </section>

      <footer className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-line pt-6 text-sm text-muted">
        <span>PricePilot</span>
        <a href="https://github.com/Cod4Nitish/pricepilot-ai" className="inline-flex min-h-11 items-center hover:text-fg hover:underline" rel="noreferrer">GitHub</a>
        <a href="https://github.com/Cod4Nitish/pricepilot-ai/tree/main/docs" className="inline-flex min-h-11 items-center hover:text-fg hover:underline" rel="noreferrer">Docs</a>
        <Link href="/settings" className="inline-flex min-h-11 items-center hover:text-fg hover:underline">Settings</Link>
      </footer>
    </div>
  );
}

import Link from "next/link";
import { BadgeCheck, Bot, Download, Search, ShieldCheck, Store } from "lucide-react";
import SearchBar from "@/components/layout/SearchBar";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STEPS = [
  { icon: Search, title: "Ask in plain language", text: "Type a product like “iPhone 15 128GB black”. We parse brand, model, storage and colour." },
  { icon: Bot, title: "Agents check retailers live", text: "Web agents open retailer pages and read the price, MRP, delivery and stock as they are right now." },
  { icon: BadgeCheck, title: "You see what is verified", text: "Every price carries a label for how it was confirmed. Weak matches are separated, never ranked cheapest." },
];

const RETAILERS = ["Amazon India", "Flipkart", "Croma", "Reliance Digital", "Vijay Sales"];

export default function HomePage() {
  return (
    <div className="space-y-16">
      <section className="pt-6 text-center sm:pt-12">
        <Badge tone="brand" className="mb-5">Price comparison you can audit</Badge>
        <h1 className="font-display text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
          Search Smarter.
          <br />
          <span className="gradient-text">Compare Better. Pay Less.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-muted sm:text-lg">
          PricePilot AI compares prices across Indian retailers and tells you exactly how each price was verified, so you never trust a number you can&apos;t check.
        </p>
        <div className="mx-auto mt-8 max-w-2xl">
          <SearchBar autoFocus={false} />
        </div>
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="mb-6 font-display text-2xl font-bold">How it works</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Card key={s.title}>
              <div className="gradient-bg mb-4 grid h-10 w-10 place-items-center rounded-xl text-white">
                <s.icon className="h-5 w-5" aria-hidden />
              </div>
              <CardTitle>
                {i + 1}. {s.title}
              </CardTitle>
              <p className="mt-2 text-sm text-muted">{s.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="trust">
        <Card className="border-primary/30">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-1 h-6 w-6 shrink-0 text-primary" aria-hidden />
            <div>
              <h2 id="trust" className="font-display text-2xl font-bold">Trust and verification</h2>
              <p className="mt-2 text-sm text-muted">We label every price. Only prices read from a page are called verified.</p>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="font-semibold text-good">Verified</dt><dd className="text-muted">Price read from the fetched retailer product page.</dd></div>
                <div><dt className="font-semibold text-primary">Agent verified</dt><dd className="text-muted">Read by a web agent on the live page.</dd></div>
                <div><dt className="font-semibold text-warn">Snippet only</dt><dd className="text-muted">Seen in a search snippet; the page was not confirmed.</dd></div>
                <div><dt className="font-semibold">Unverified</dt><dd className="text-muted">Could not be confirmed. Never used for “best price”.</dd></div>
              </dl>
              <p className="mt-4 text-xs text-muted">Bank and coupon offers are shown verbatim from the page; their conditions are not verified. Delivery shows “Unknown” when we can&apos;t tell.</p>
            </div>
          </div>
        </Card>
      </section>

      <section aria-labelledby="retailers">
        <h2 id="retailers" className="mb-2 flex items-center gap-2 font-display text-2xl font-bold">
          <Store className="h-6 w-6" aria-hidden /> Retailers we try
        </h2>
        <p className="mb-4 text-sm text-muted">Availability is not guaranteed: each retailer&apos;s status is checked live on every search, and some may block automated access or return nothing.</p>
        <ul className="flex flex-wrap gap-2">
          {RETAILERS.map((r) => (
            <li key={r}><Badge className="px-4 py-1.5 text-sm text-fg">{r}</Badge></li>
          ))}
        </ul>
      </section>

      <section>
        <Card className="flex flex-col items-start gap-4 bg-gradient-to-br from-primary/10 to-accent/10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-xl font-bold">Install PricePilot AI</h2>
            <p className="text-sm text-muted">Add it to your home screen for an app-like experience. Works on Android, iPhone and desktop.</p>
          </div>
          <Button asChild>
            <Link href="/settings#install"><Download className="h-4 w-4" aria-hidden /> Install instructions</Link>
          </Button>
        </Card>
      </section>
    </div>
  );
}

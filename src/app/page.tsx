import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Download,
  EyeOff,
  FileText,
  HelpCircle,
  Search,
  ShieldCheck,
  Store,
  Truck,
  Zap,
} from "lucide-react";
import HeroSearch from "@/components/layout/HeroSearch";
import HeroVisual from "@/components/layout/HeroVisual";
import { Button } from "@/components/ui/button";

const TRUST = [
  { icon: Bot, title: "Read from the page", text: "Agents open the retailer product page and read the listed price." },
  { icon: BadgeCheck, title: "Every price labelled", text: "Verified, agent verified, snippet only or unverified, always visible." },
  { icon: EyeOff, title: "Weak matches stay out", text: "Look-alike products are separated and never ranked as cheapest." },
  { icon: Truck, title: "Honest about gaps", text: "Delivery shows Unknown when we cannot tell. No sample data, ever." },
];

const STEPS = [
  { icon: Search, title: "Search or paste a link", text: "Type a product like “iPhone 15 128GB black”, or paste a product link. We parse brand, model, storage and colour." },
  { icon: Bot, title: "Agents check retailers live", text: "Web agents open retailer pages and read price, MRP, delivery and stock as they are right now." },
  { icon: BadgeCheck, title: "Compare what is verified", text: "See the best verified price, the evidence it came from, and which retailers blocked or returned nothing." },
];

const LABELS = [
  { icon: BadgeCheck, name: "Verified", tone: "text-good", text: "Price read from the fetched retailer product page. Eligible for “best verified”." },
  { icon: Bot, name: "Agent verified", tone: "text-primary", text: "Read by a web agent on the live page. Eligible for “best verified”." },
  { icon: FileText, name: "Snippet only", tone: "text-warn", text: "Seen in a search snippet; the page was not confirmed. Never used for “best”." },
  { icon: HelpCircle, name: "Unverified", tone: "text-muted", text: "Could not be confirmed. Shown for transparency only." },
];

const RETAILERS = ["Amazon India", "Flipkart", "Croma", "Reliance Digital", "Vijay Sales"];

export default function HomePage() {
  return (
    <div className="space-y-16 sm:space-y-20">
      <section aria-label="Search" className="relative grid items-center gap-10 pt-2 lg:grid-cols-[1.15fr_0.85fr] lg:pt-8">
        <div aria-hidden className="bg-grid pointer-events-none absolute inset-x-0 -top-6 -z-10 h-[28rem]" />
        <HeroSearch />
        <HeroVisual />
      </section>

      <section aria-labelledby="trust">
        <h2 id="trust" className="sr-only">How PricePilot keeps prices trustworthy</h2>
        <ul className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map((t) => (
            <li key={t.title} className="bg-surface p-4">
              <t.icon className="mb-2 h-5 w-5 text-primary" aria-hidden />
              <p className="font-display font-semibold">{t.title}</p>
              <p className="mt-1 text-sm text-muted">{t.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="modes">
        <h2 id="modes" className="mb-1 font-display text-h2 font-bold">Pick how you shop</h2>
        <p className="mb-5 text-muted">Two modes, one honest approach to prices.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Link href="/fast" className="group relative flex flex-col gap-3 overflow-hidden rounded-3xl border border-line-strong bg-surface p-6 transition-colors hover:border-primary">
            <span className="gradient-bg grid h-11 w-11 place-items-center rounded-xl"><Zap className="h-5 w-5" aria-hidden /></span>
            <h3 className="font-display text-xl font-bold">Fast Commerce</h3>
            <p className="text-muted">Groceries and essentials from quick-delivery apps, checked for your pincode when you choose to share it.</p>
            <span className="mt-auto inline-flex min-h-11 items-center gap-2 font-semibold text-primary">
              Open Fast Commerce <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
            </span>
          </Link>
          <Link href="/search" className="group relative flex flex-col gap-3 overflow-hidden rounded-3xl border border-line-strong bg-surface p-6 transition-colors hover:border-primary">
            <span className="gradient-bg grid h-11 w-11 place-items-center rounded-xl"><Store className="h-5 w-5" aria-hidden /></span>
            <h3 className="font-display text-xl font-bold">E-Commerce</h3>
            <p className="text-muted">Electronics, appliances and more across major retailers, with the evidence behind every price.</p>
            <span className="mt-auto inline-flex min-h-11 items-center gap-2 font-semibold text-primary">
              Compare retailers <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden />
            </span>
          </Link>
        </div>
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="mb-5 font-display text-h2 font-bold">How it works</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-2xl border border-line bg-surface p-5">
              <div className="mb-3 flex items-center gap-3">
                <span className="gradient-bg grid h-10 w-10 place-items-center rounded-xl"><s.icon className="h-5 w-5" aria-hidden /></span>
                <span className="tabular font-display text-sm font-bold text-muted">Step {i + 1}</span>
              </div>
              <h3 className="font-display font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-sm text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="verify" className="rounded-3xl border border-line-strong bg-surface p-5 sm:p-8">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-1 h-6 w-6 shrink-0 text-good" aria-hidden />
          <div>
            <h2 id="verify" className="font-display text-h2 font-bold">Verification, explained</h2>
            <p className="mt-1 max-w-2xl text-muted">Only prices read from a page are called verified. The label sits next to every price, in words, so you never rely on colour alone.</p>
          </div>
        </div>
        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          {LABELS.map((l) => (
            <div key={l.name} className="rounded-2xl bg-surface2 p-4">
              <dt className={`flex items-center gap-2 font-display font-semibold ${l.tone}`}><l.icon className="h-4 w-4" aria-hidden /> {l.name}</dt>
              <dd className="mt-1 text-sm text-muted">{l.text}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 text-sm text-muted">Bank and coupon offers are shown verbatim from the page; their conditions are not verified. Retailers may block automated access, and each search shows exactly which ones did.</p>
      </section>

      <section aria-labelledby="retailers">
        <h2 id="retailers" className="mb-2 font-display text-h2 font-bold">Retailers we try</h2>
        <p className="mb-4 max-w-2xl text-sm text-muted">Availability is not guaranteed: each retailer&apos;s status is checked live on every search and shown to you.</p>
        <ul className="flex flex-wrap gap-2">
          {RETAILERS.map((r) => (
            <li key={r} className="rounded-full border border-line-strong bg-surface px-4 py-2 text-sm font-medium">{r}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="install" className="flex flex-col items-start gap-4 rounded-3xl border border-primary/40 bg-primary/5 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="install" className="font-display text-xl font-bold">Install PricePilot AI</h2>
          <p className="text-muted">Add it to your home screen for an app-like experience on Android, iPhone and desktop.</p>
        </div>
        <Button asChild size="lg">
          <Link href="/settings#install"><Download className="h-4 w-4" aria-hidden /> Install instructions</Link>
        </Button>
      </section>
    </div>
  );
}

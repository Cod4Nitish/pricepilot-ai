"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Menu, Moon, Plane, Sun } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { BOTTOM_NAV, MORE_ICON, MORE_NAV, MOBILE_MORE, TOP_NAV } from "./nav";
import { useTheme } from "@/app/providers";
import SmartSearch from "./SmartSearch";
import LocationChip from "./LocationChip";
import type { SearchMode } from "./discover-api";
import { Sheet } from "@/components/ui/sheet";

function isActive(path: string, href: string) {
  if (href === "/") return path === "/";
  if (href === "/search") return path.startsWith("/search") || path.startsWith("/product");
  return path.startsWith(href);
}

export function Logo({ className, wordmark = true }: { className?: string; wordmark?: boolean }) {
  return (
    <Link href="/" className={cn("flex min-h-11 items-center gap-2", className)} aria-label="PricePilot home">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-white">
        <Plane className="h-4 w-4" aria-hidden />
      </span>
      {wordmark && <span className="text-base font-semibold tracking-tight">PricePilot</span>}
    </Link>
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg text-muted hover:bg-surface2 hover:text-fg"
    >
      {theme === "dark" ? <Sun className="h-5 w-5" aria-hidden /> : <Moon className="h-5 w-5" aria-hidden />}
    </button>
  );
}

function HeaderSearch() {
  const p = useSearchParams();
  const q = p.get("q") ?? "";
  const m = p.get("mode") ?? "auto";
  const mode: SearchMode = m === "ecommerce" || m === "quick" || m === "both" ? m : "auto";
  return <SmartSearch key={`${q}|${mode}`} initial={q} initialMode={mode} />;
}

function DesktopMore({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const anyActive = MORE_NAV.some((n) => isActive(path, n.href));
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          "inline-flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-sm font-medium hover:bg-surface2",
          anyActive ? "text-primary" : "text-muted hover:text-fg",
        )}
      >
        More
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="More">
        <MoreList items={MORE_NAV} path={path} onNavigate={() => setOpen(false)} />
      </Sheet>
    </>
  );
}

function MoreList({ items, path, onNavigate }: { items: typeof MORE_NAV; path: string; onNavigate: () => void }) {
  return (
    <ul className="grid gap-1">
      {items.map((n) => (
        <li key={n.href}>
          <Link
            href={n.href}
            onClick={onNavigate}
            aria-current={isActive(path, n.href) ? "page" : undefined}
            className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-base font-medium hover:bg-surface2 aria-[current=page]:text-primary"
          >
            <n.icon className="h-5 w-5" aria-hidden />
            {n.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "/";
  const [more, setMore] = useState(false);
  const reduce = useReducedMotion();
  return (
    <div className="min-h-dvh overflow-x-clip">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <header className="safe-top sticky top-0 z-30 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2 sm:gap-4 sm:px-6">
          <Logo />
          <div className="hidden min-w-0 flex-1 lg:block">
            <Suspense fallback={null}><HeaderSearch /></Suspense>
          </div>
          <div className="ml-auto flex items-center gap-1 lg:ml-0">
            <LocationChip />
            <nav aria-label="Main" className="hidden items-center lg:flex">
              {TOP_NAV.map((n) => {
                const active = isActive(path, n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium hover:bg-surface2",
                      active ? "text-primary" : "text-muted hover:text-fg",
                    )}
                  >
                    {n.label}
                  </Link>
                );
              })}
              <DesktopMore path={path} />
            </nav>
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setMore(true)}
              aria-label="Menu"
              aria-haspopup="dialog"
              className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg text-muted hover:bg-surface2 hover:text-fg lg:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-3 pb-2 sm:px-6 lg:hidden">
          <Suspense fallback={null}><HeaderSearch /></Suspense>
        </div>
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-6xl px-4 pb-28 pt-6 focus:outline-none sm:px-6 lg:pb-12 [html[data-install]_&]:pb-48 lg:[html[data-install]_&]:pb-12"
      >
        <motion.div key={path} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
          {children}
        </motion.div>
      </main>

      <nav aria-label="Primary" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface lg:hidden">
        <ul className="mx-auto flex max-w-lg items-stretch justify-around">
          {BOTTOM_NAV.map((n) => {
            const active = isActive(path, n.href);
            return (
              <li key={n.href} className="flex-1">
                <Link
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium",
                    active ? "text-primary" : "text-muted",
                  )}
                >
                  <n.icon className="h-5 w-5" aria-hidden />
                  {n.label}
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setMore(true)}
              aria-haspopup="dialog"
              className="flex min-h-14 w-full cursor-pointer flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted"
            >
              <MORE_ICON className="h-5 w-5" aria-hidden />
              More
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title="More">
        <MoreList items={MOBILE_MORE} path={path} onNavigate={() => setMore(false)} />
      </Sheet>
    </div>
  );
}

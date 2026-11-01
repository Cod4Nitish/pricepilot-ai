"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Moon, Plane, Sun } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { NAV } from "./nav";
import { useTheme } from "@/app/providers";
import SearchBar from "./SearchBar";
import { ModeSwitch } from "@/components/ui/mode-switch";
import { Sheet } from "@/components/ui/sheet";

function isActive(path: string, href: string) {
  if (href === "/") return path === "/";
  if (href === "/search") return path.startsWith("/search") || path.startsWith("/product");
  return path.startsWith(href);
}

export function Logo({ className, wordmark = true }: { className?: string; wordmark?: boolean }) {
  return (
    <Link href="/" className={cn("flex min-h-11 items-center gap-2.5", className)} aria-label="PricePilot AI home">
      <span className="gradient-bg grid h-9 w-9 place-items-center rounded-xl shadow-glow">
        <Plane className="h-5 w-5" aria-hidden />
      </span>
      {wordmark && (
        <span className="font-display text-lg font-bold tracking-tight">
          PricePilot <span className="gradient-text">AI</span>
        </span>
      )}
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
      className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-line-strong bg-surface2 text-muted hover:text-fg"
    >
      {theme === "dark" ? <Sun className="h-5 w-5" aria-hidden /> : <Moon className="h-5 w-5" aria-hidden />}
    </button>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "/";
  const [more, setMore] = useState(false);
  const reduce = useReducedMotion();
  const showHeaderSearch = path !== "/search" && path !== "/";
  return (
    <div className="min-h-dvh lg:pl-64">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col gap-5 overflow-y-auto border-r border-line bg-surface p-5 lg:flex">
        <Logo />
        <ModeSwitch />
        <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
          {NAV.map((n) => {
            const active = isActive(path, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                  active ? "bg-primary/12 text-primary shadow-[inset_3px_0_0_var(--primary)]" : "text-muted hover:bg-surface2 hover:text-fg",
                )}
              >
                <n.icon className="h-5 w-5" aria-hidden />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <p className="text-xs leading-relaxed text-muted">Every price is labelled with how it was verified.</p>
      </aside>

      {/* Header: sticky on all sizes */}
      <header className="safe-top sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2 sm:gap-3 sm:px-6">
          <Logo className="lg:hidden" wordmark={false} />
          <ModeSwitch compact className="min-w-0 flex-1 lg:hidden" />
          <div className="hidden min-w-0 flex-1 lg:block">{showHeaderSearch && <SearchBar compact />}</div>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setMore(true)}
            aria-label="More pages"
            aria-haspopup="dialog"
            className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-line-strong bg-surface2 text-muted hover:text-fg lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
        </div>
        {showHeaderSearch && (
          <div className="mx-auto max-w-6xl px-3 pb-2 sm:px-6 lg:hidden">
            <SearchBar compact />
          </div>
        )}
      </header>

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-6xl px-4 pb-28 pt-6 focus:outline-none sm:px-6 lg:pb-12 [html[data-install]_&]:pb-48 lg:[html[data-install]_&]:pb-12"
      >
        <motion.div key={path} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
          {children}
        </motion.div>
      </main>

      {/* Mobile bottom nav: exactly 5 items */}
      <nav aria-label="Primary" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface lg:hidden">
        <ul className="mx-auto flex max-w-lg items-stretch justify-around">
          {NAV.filter((n) => n.mobile).map((n) => {
            const active = isActive(path, n.href);
            return (
              <li key={n.href} className="flex-1">
                <Link
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold",
                    active ? "text-primary" : "text-muted",
                  )}
                >
                  {active && <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-full bg-primary" />}
                  <n.icon className="h-5 w-5" aria-hidden />
                  {n.short ?? n.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title="More">
        <ul className="grid gap-1">
          {NAV.filter((n) => !n.mobile).map((n) => (
            <li key={n.href}>
              <Link
                href={n.href}
                onClick={() => setMore(false)}
                aria-current={isActive(path, n.href) ? "page" : undefined}
                className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-base font-medium hover:bg-surface2 aria-[current=page]:text-primary"
              >
                <n.icon className="h-5 w-5" aria-hidden />
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
      </Sheet>
    </div>
  );
}

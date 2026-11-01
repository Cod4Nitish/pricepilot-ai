"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Plane, Settings, Sun } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { NAV } from "./nav";
import { useTheme } from "@/app/providers";
import SearchBar from "./SearchBar";

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path.startsWith(href);
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2.5", className)} aria-label="PricePilot AI home">
      <span className="gradient-bg grid h-9 w-9 place-items-center rounded-xl text-white shadow-lg shadow-primary/30">
        <Plane className="h-5 w-5" aria-hidden />
      </span>
      <span className="font-display text-lg font-bold tracking-tight">
        PricePilot <span className="gradient-text">AI</span>
      </span>
    </Link>
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="grid h-10 w-10 cursor-pointer place-items-center rounded-xl border border-line bg-surface2 text-muted hover:text-fg"
    >
      {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line bg-surface/60 p-5 backdrop-blur-xl lg:flex">
        <Logo />
        <nav aria-label="Main" className="mt-8 flex flex-1 flex-col gap-1">
          {NAV.map((n) => {
            const active = isActive(path, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active ? "bg-primary/10 text-primary" : "text-muted hover:bg-surface2 hover:text-fg",
                )}
              >
                <n.icon className="h-5 w-5" aria-hidden />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <p className="text-xs leading-relaxed text-muted">Search Smarter. Compare Better. Pay Less.</p>
      </aside>

      {/* Top bar */}
      <header className="safe-top sticky top-0 z-30 border-b border-line bg-bg/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Logo className="lg:hidden" />
          <div className="flex-1">{path !== "/search" && path !== "/" && <SearchBar compact />}</div>
          <ThemeToggle />
          <Link
            href="/settings"
            aria-label="Settings"
            className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface2 text-muted hover:text-fg lg:hidden"
          >
            <Settings className="h-5 w-5" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:pb-12">
        <motion.div key={path} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          {children}
        </motion.div>
      </main>

      {/* Mobile bottom nav */}
      <nav
        aria-label="Primary"
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/80 backdrop-blur-xl lg:hidden"
      >
        <ul className="mx-auto flex max-w-lg items-stretch justify-around">
          {NAV.filter((n) => n.mobile).map((n) => {
            const active = isActive(path, n.href);
            return (
              <li key={n.href} className="flex-1">
                <Link
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                    active ? "text-primary" : "text-muted",
                  )}
                >
                  <n.icon className="h-5 w-5" aria-hidden />
                  {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

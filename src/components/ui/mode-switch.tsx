"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Store, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const MODES = [
  { id: "fast", href: "/fast", label: "Fast Commerce", short: "Fast", icon: Zap },
  { id: "ecom", href: "/search", label: "E-Commerce", short: "E-Com", icon: Store },
] as const;

/** Segmented control: Fast Commerce | E-Commerce. Active mode is derived from the route. */
export function ModeSwitch({ className, compact }: { className?: string; compact?: boolean }) {
  const path = usePathname() ?? "/";
  const active = path.startsWith("/fast") || path.startsWith("/battle") ? "fast" : "ecom";
  return (
    <nav aria-label="Shopping mode" className={className}>
      <ul className="flex rounded-xl border border-line-strong bg-surface2 p-1">
        {MODES.map((m) => {
          const on = active === m.id;
          return (
            <li key={m.id} className="flex-1">
              <Link
                href={m.href}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition-colors",
                  on ? "gradient-bg shadow" : "text-muted hover:text-fg",
                )}
              >
                <m.icon className="h-4 w-4" aria-hidden />
                {compact ? m.short : m.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

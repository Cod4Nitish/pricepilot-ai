"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export default function SearchBar({
  compact,
  initial = "",
  autoFocus,
  onSubmitQuery,
}: {
  compact?: boolean;
  initial?: string;
  autoFocus?: boolean;
  onSubmitQuery?: (q: string) => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const v = q.trim();
        if (!v) return;
        if (onSubmitQuery) onSubmitQuery(v);
        else router.push(`/search?q=${encodeURIComponent(v)}`);
      }}
      className={cn("flex items-center gap-2", compact ? "max-w-xl" : "")}
    >
      <label htmlFor={compact ? "q-compact" : "q-main"} className="sr-only">
        Search for a product
      </label>
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden />
        <input
          id={compact ? "q-compact" : "q-main"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus={autoFocus}
          enterKeyHint="search"
          placeholder="e.g. iPhone 15 128GB, Sony WH-1000XM5"
          className={cn(
            "w-full rounded-2xl border border-line bg-surface pl-12 pr-4 text-fg placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30",
            compact ? "h-10 text-sm" : "h-14 text-base",
          )}
        />
      </div>
      {!compact && (
        <button
          type="submit"
          className="gradient-bg h-14 cursor-pointer rounded-2xl px-6 font-semibold text-white shadow-lg shadow-primary/25 hover:brightness-110"
        >
          Compare
        </button>
      )}
    </form>
  );
}

"use client";
import { cn } from "@/lib/utils";

export interface TabItem<T extends string> {
  value: T;
  label: string;
}

/** Accessible segmented tab control (tablist/tab roles, arrow-key navigation). */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  function onKey(e: React.KeyboardEvent, i: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const n = (i + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    onChange(items[n].value);
    (e.currentTarget.parentElement?.children[n] as HTMLElement | undefined)?.focus();
  }
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-xl border border-line-strong bg-surface2 p-1">
      {items.map((it, i) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          tabIndex={value === it.value ? 0 : -1}
          onKeyDown={(e) => onKey(e, i)}
          onClick={() => onChange(it.value)}
          className={cn(
            "h-11 min-w-11 sm:h-10 cursor-pointer rounded-lg px-4 text-sm font-medium transition-colors",
            value === it.value ? "bg-primary text-white" : "text-muted hover:text-fg",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

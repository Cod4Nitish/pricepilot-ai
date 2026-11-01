"use client";
import { useState } from "react";
import { Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BasketLine } from "@/lib/fast/types";

export const MAX_ITEMS = 8;

/** Parse `?i=name~qty` params (repeatable) into basket lines. */
export function linesFromParams(sp: URLSearchParams): BasketLine[] {
  return sp
    .getAll("i")
    .slice(0, MAX_ITEMS)
    .map((v) => {
      const [name, q] = v.split("~");
      return { query: (name ?? "").trim().slice(0, 80), qty: Math.min(20, Math.max(1, Number(q) || 1)) };
    })
    .filter((l) => l.query.length >= 2);
}

export function ItemsEditor({ items, onChange, disabled }: { items: BasketLine[]; onChange: (l: BasketLine[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState("");
  function add(e: React.FormEvent) {
    e.preventDefault();
    const q = draft.trim();
    if (q.length < 2 || items.length >= MAX_ITEMS) return;
    if (items.some((i) => i.query.toLowerCase() === q.toLowerCase())) return setDraft("");
    onChange([...items, { query: q, qty: 1 }]);
    setDraft("");
  }
  const setQty = (idx: number, d: number) =>
    onChange(items.map((it, i) => (i === idx ? { ...it, qty: Math.min(20, Math.max(1, it.qty + d)) } : it)));
  return (
    <div className="space-y-3">
      <form onSubmit={add} className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. Amul Gold milk 500 ml, eggs 12 pcs"
          aria-label="Add a grocery item (include the pack size for exact matches)"
          maxLength={80}
          disabled={disabled || items.length >= MAX_ITEMS}
        />
        <Button type="submit" variant="secondary" disabled={disabled || draft.trim().length < 2 || items.length >= MAX_ITEMS}>
          Add
        </Button>
      </form>
      <p className="text-xs text-muted">
        Include the pack size (500 ml, 1 kg, 12 pcs) so stores are compared on the exact same variant. {items.length}/{MAX_ITEMS} items.
      </p>
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={it.query} className="flex items-center gap-2 rounded-xl border border-line bg-surface2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm">{it.query}</span>
              <Button type="button" size="icon" variant="ghost" aria-label={`Decrease quantity of ${it.query}`} disabled={disabled} onClick={() => setQty(i, -1)}>
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-6 text-center text-sm tabular-nums" aria-label={`Quantity ${it.qty}`}>{it.qty}</span>
              <Button type="button" size="icon" variant="ghost" aria-label={`Increase quantity of ${it.query}`} disabled={disabled} onClick={() => setQty(i, 1)}>
                <Plus className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${it.query}`} disabled={disabled} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

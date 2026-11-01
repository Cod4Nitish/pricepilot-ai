"use client";
import { useCallback, useEffect, useState } from "react";
import type { BasketLine } from "./types";

const KEY = "pricepilot:basket";

export function useBasketLines() {
  const [lines, setLines] = useState<BasketLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const s = localStorage.getItem(KEY);
      if (s) setLines(JSON.parse(s) as BasketLine[]);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const persist = useCallback((next: BasketLine[]) => {
    setLines(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const add = useCallback(
    (query: string, qty = 1) => {
      const q = query.trim();
      if (!q) return;
      const existing = lines.find((l) => l.query.toLowerCase() === q.toLowerCase());
      persist(existing ? lines.map((l) => (l === existing ? { ...l, qty: l.qty + qty } : l)) : [...lines, { query: q, qty }]);
    },
    [lines, persist],
  );
  const setQty = useCallback(
    (i: number, qty: number) => persist(lines.map((l, j) => (j === i ? { ...l, qty: Math.max(1, Math.min(99, qty)) } : l))),
    [lines, persist],
  );
  const remove = useCallback((i: number) => persist(lines.filter((_, j) => j !== i)), [lines, persist]);
  const clear = useCallback(() => persist([]), [persist]);

  return { lines, ready, add, setQty, remove, clear };
}

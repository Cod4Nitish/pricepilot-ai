"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Pause, Play } from "lucide-react";
import SearchBar from "./SearchBar";

const WORDS = ["iPhone 16", "Sony headphones", "running shoes", "smart TVs", "air fryers", "laptops"];
const EXAMPLES = ["iPhone 15 128GB", "Sony WH-1000XM5", "boAt Airdopes 141", "Samsung 43 inch smart TV"];

/**
 * Search-first hero. The rotating category word types out and PAUSES on hover/focus,
 * has an explicit pause button, and is static under prefers-reduced-motion.
 */
export default function HeroSearch() {
  const [reduced, setReduced] = useState(true); // start static; enable motion after mount if allowed
  const [userPaused, setUserPaused] = useState(false);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [i, setI] = useState(0);
  const [len, setLen] = useState(WORDS[0].length);
  const [phase, setPhase] = useState<"typing" | "holding" | "deleting">("holding");

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const paused = reduced || userPaused || hoverPaused;
  useEffect(() => {
    if (paused) return;
    const word = WORDS[i];
    let t: ReturnType<typeof setTimeout> | undefined;
    if (phase === "typing") {
      if (len < word.length) t = setTimeout(() => setLen(len + 1), 70);
      else setPhase("holding");
    } else if (phase === "holding") {
      t = setTimeout(() => setPhase("deleting"), 1800);
    } else if (len > 0) {
      t = setTimeout(() => setLen(len - 1), 35);
    } else {
      setI((i + 1) % WORDS.length);
      setPhase("typing");
    }
    return () => clearTimeout(t);
  }, [paused, phase, i, len]);

  const word = WORDS[i];
  const display = reduced ? WORDS[0] : paused ? word : word.slice(0, len);

  return (
    <div
      onMouseEnter={() => setHoverPaused(true)}
      onMouseLeave={() => setHoverPaused(false)}
      onFocusCapture={() => setHoverPaused(true)}
      onBlurCapture={() => setHoverPaused(false)}
    >
      <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-good/40 bg-good/10 px-3 py-1.5 text-xs font-semibold text-good">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-good" /> Every price shows how it was verified
      </p>
      <h1 className="font-display text-display font-bold text-balance">
        Compare prices for
        <span className="mt-1 block min-h-[1.1em] gradient-text" aria-hidden="true">
          {display}
          {!reduced && <span className="caret" />}
        </span>
        <span className="sr-only">any product across Indian retailers</span>
      </h1>
      <p className="mt-4 max-w-xl text-body text-muted">
        Search by name or paste a product link. Web agents read each retailer page, and we show the price, how it was verified, and what we could not confirm.
      </p>

      <div className="mt-6 max-w-2xl">
        <SearchBar hero inputId="hero-search" />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Try:</span>
        {EXAMPLES.map((ex) => (
          <Link
            key={ex}
            href={`/search?q=${encodeURIComponent(ex)}`}
            className="inline-flex min-h-11 items-center rounded-full border border-line-strong bg-surface px-4 text-sm font-medium hover:border-primary hover:text-primary"
          >
            {ex}
          </Link>
        ))}
        {!reduced && (
          <button
            type="button"
            onClick={() => setUserPaused((p) => !p)}
            aria-pressed={userPaused}
            className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted hover:text-fg"
          >
            {userPaused ? <Play className="h-3.5 w-3.5" aria-hidden /> : <Pause className="h-3.5 w-3.5" aria-hidden />}
            {userPaused ? "Resume headline animation" : "Pause headline animation"}
          </button>
        )}
      </div>
    </div>
  );
}

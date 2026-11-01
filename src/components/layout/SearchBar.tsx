"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPaste, Mic, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/** If the text is a product URL, derive a readable product name from its path. Returns null for plain text. */
export function queryFromLink(raw: string): string | null {
  const t = raw.trim();
  if (!/^https?:\/\//i.test(t)) return null;
  try {
    const u = new URL(t);
    const segs = u.pathname.split("/").filter(Boolean).filter((s) => !/^(dp|p|gp|product|products|ip|buy|itm)$/i.test(s));
    const best = segs.filter((s) => /[a-z]{3,}/i.test(s)).sort((a, b) => b.length - a.length)[0];
    if (!best) return null;
    const q = decodeURIComponent(best).replace(/[-_+]+/g, " ").replace(/\.(html?|php)$/i, "").replace(/\s+/g, " ").trim();
    return q.length >= 3 ? q : null;
  } catch {
    return null;
  }
}

type SR = { start: () => void; stop: () => void; lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };

export default function SearchBar({
  compact,
  initial = "",
  autoFocus,
  onSubmitQuery,
  hero,
  inputId,
}: {
  compact?: boolean;
  initial?: string;
  autoFocus?: boolean;
  onSubmitQuery?: (q: string) => void;
  /** Large landing-page variant with paste + voice affordances. */
  hero?: boolean;
  inputId?: string;
}) {
  const router = useRouter();
  const autoId = useId();
  const id = inputId ?? (compact ? `q-compact-${autoId}` : `q-main-${autoId}`);
  const [q, setQ] = useState(initial);
  const [note, setNote] = useState("");
  const [listening, setListening] = useState(false);
  const [voice, setVoice] = useState(false);
  const recRef = useRef<SR | null>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setVoice(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  function go(value: string) {
    const link = queryFromLink(value);
    const v = (link ?? value).trim();
    if (!v) return;
    if (onSubmitQuery) onSubmitQuery(v);
    else router.push(`/search?q=${encodeURIComponent(v)}`);
  }

  async function paste() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        setNote("Clipboard is empty.");
        return;
      }
      setQ(text);
      const link = queryFromLink(text);
      setNote(link ? `Link detected. We will search by the product name in it: "${link}".` : "Pasted from clipboard.");
    } catch {
      setNote("Could not read the clipboard. Paste with Ctrl+V or long-press instead.");
    }
  }

  function listen() {
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = "en-IN";
    r.interimResults = false;
    r.onresult = (e) => setQ(e.results[0][0].transcript);
    r.onend = () => setListening(false);
    r.onerror = () => {
      setListening(false);
      setNote("Voice input was not available. Please type instead.");
    };
    recRef.current = r;
    setListening(true);
    setNote("");
    r.start();
  }

  const big = !compact;
  return (
    <form
      role="search"
      aria-label="Product search"
      onSubmit={(e) => {
        e.preventDefault();
        go(q);
      }}
      className={cn(compact ? "w-full max-w-xl" : "")}
    >
      <label htmlFor={id} className="sr-only">
        Search for a product, or paste a product link
      </label>
      <div className={cn("flex items-center gap-2", hero && "rounded-xl border border-line-strong bg-surface p-2 focus-within:border-primary")}>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            id={id}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (note) setNote("");
            }}
            autoFocus={autoFocus}
            enterKeyHint="search"
            autoComplete="off"
            placeholder={compact ? "Search products" : "Search a product or paste a link"}
            className={cn(
              "w-full text-fg placeholder:text-muted",
              hero ? "h-14 rounded-lg bg-transparent pl-12 pr-2 text-base outline-none focus-visible:outline-none" : "rounded-lg border border-line-strong bg-surface pl-12 pr-4 focus:border-primary",
              !hero && (compact ? "h-11 text-base sm:text-sm" : "h-14 text-base"),
            )}
          />
        </div>
        {big && (
          <>
            <button
              type="button"
              onClick={paste}
              aria-label="Paste from clipboard"
              className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl text-muted hover:bg-surface2 hover:text-fg"
            >
              <ClipboardPaste className="h-5 w-5" aria-hidden />
            </button>
            {voice && (
              <button
                type="button"
                onClick={listen}
                aria-pressed={listening}
                aria-label={listening ? "Stop voice input" : "Search by voice"}
                className={cn(
                  "grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl hover:bg-surface2",
                  listening ? "bg-bad/15 text-bad" : "text-muted hover:text-fg",
                )}
              >
                <Mic className="h-5 w-5" aria-hidden />
              </button>
            )}
            <button
              type="submit"
              className="bg-primary text-white h-12 shrink-0 cursor-pointer rounded-lg px-5 text-base font-semibold sm:px-7"
            >
              Compare
            </button>
          </>
        )}
      </div>
      <p role="status" aria-live="polite" className="mt-2 text-xs text-muted empty:hidden">
        {listening ? "Listening..." : note}
      </p>
    </form>
  );
}

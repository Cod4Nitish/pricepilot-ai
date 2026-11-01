"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPaste, Loader2, Mic, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchIntent, MODE_LABEL, type SearchMode } from "./discover-api";
import { queryFromLink } from "./SearchBar";

interface SRResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SREvent {
  resultIndex: number;
  results: ArrayLike<SRResult>;
}
interface SR {
  start: () => void;
  stop: () => void;
  abort: () => void;
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type SRCtor = new () => SR;

const MODES: { value: SearchMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "ecommerce", label: "E-Commerce" },
  { value: "quick", label: "Quick" },
  { value: "both", label: "Both" },
];

function getCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Unified smart search: type or speak. Calls /api/intent to decide E-Commerce / Quick / Both,
 * announces the routing, then opens /discover. A manual override is always available.
 */
export default function SmartSearch({
  variant = "compact",
  initial = "",
  initialMode = "auto",
  autoFocus,
  inputId,
}: {
  variant?: "hero" | "compact";
  initial?: string;
  initialMode?: SearchMode;
  autoFocus?: boolean;
  inputId?: string;
}) {
  const router = useRouter();
  const uid = useId();
  const id = inputId ?? `smart-${uid}`;
  const hero = variant === "hero";
  const [q, setQ] = useState(initial);
  const [mode, setMode] = useState<SearchMode>(initialMode);
  const [lang, setLang] = useState<"en-IN" | "hi-IN">("en-IN");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [route, setRoute] = useState("");
  const recRef = useRef<SR | null>(null);
  const finalRef = useRef("");

  useEffect(() => () => recRef.current?.abort(), []);

  async function go(raw: string) {
    const link = queryFromLink(raw);
    const text = (link ?? raw).trim();
    if (!text || busy) return;
    setBusy(true);
    setNote("");
    let chosen: string = mode;
    if (mode === "auto") {
      try {
        const r = await fetchIntent(text);
        const reason = r.items[0]?.reason ?? "";
        setRoute(`Searching ${MODE_LABEL[r.overall]}${r.items.length > 1 ? ` (${r.items.length} items)` : ""}${reason ? `: ${reason}` : ""}`);
      } catch {
        setRoute("Could not auto-route, so Discover will decide for you.");
      }
    } else {
      setRoute(`Searching ${MODE_LABEL[mode]} (your choice)`);
    }
    router.push(`/discover?q=${encodeURIComponent(text)}&mode=${chosen}`);
    setBusy(false);
  }

  async function paste() {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (!t) return setNote("Clipboard is empty.");
      setQ(t);
      const l = queryFromLink(t);
      setNote(l ? `Link detected. We will search by the product name in it: "${l}".` : "Pasted from clipboard.");
    } catch {
      setNote("Could not read the clipboard. Paste with Ctrl+V or long-press instead.");
    }
  }

  function toggleMic() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = getCtor();
    if (!Ctor) {
      setNote("Voice search is not supported in this browser. Try Chrome or Edge, or type your request.");
      return;
    }
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    finalRef.current = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalRef.current += res[0].transcript;
        else interim += res[0].transcript;
      }
      setQ((finalRef.current + interim).trim());
    };
    r.onerror = (e) => {
      setListening(false);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setNote("Microphone permission was denied. Allow microphone access in your browser settings, or type instead.");
      else if (e.error === "no-speech") setNote("I did not hear anything. Tap the mic and try again.");
      else if (e.error !== "aborted") setNote("Voice input failed. Please type your request instead.");
    };
    r.onend = () => {
      setListening(false);
      const said = finalRef.current.trim();
      if (said) {
        setQ(said);
        void go(said);
      }
    };
    recRef.current = r;
    setNote("");
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
      setNote("Voice input could not start. Please try again.");
    }
  }

  const status = listening ? `Listening in ${lang === "hi-IN" ? "Hindi" : "English"}... ${q}` : busy ? "Working out where to search..." : route || note;

  return (
    <form
      role="search"
      aria-label={hero ? "Smart product search" : "Search"}
      onSubmit={(e) => {
        e.preventDefault();
        void go(q);
      }}
      className="w-full"
    >
      <label htmlFor={id} className="sr-only">
        Search by typing or voice, or paste a product link
      </label>
      <div
        className={cn(
          "flex items-center gap-1.5",
          hero ? "rounded-3xl border border-line-strong bg-surface p-2 shadow-pop focus-within:border-primary" : "rounded-2xl border border-line-strong bg-surface pr-1 focus-within:border-primary",
        )}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            id={id}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (note) setNote("");
            }}
            autoFocus={autoFocus}
            autoComplete="off"
            enterKeyHint="search"
            placeholder={listening ? "Listening..." : hero ? "Try “milk, eggs and a Samsung S24”" : "Search or speak"}
            className={cn(
              "w-full min-w-0 bg-transparent pl-11 pr-2 text-base text-fg outline-none placeholder:text-muted focus-visible:outline-none",
              hero ? "h-14" : "h-11 sm:text-sm",
            )}
          />
        </div>
        {hero && (
          <button
            type="button"
            onClick={paste}
            aria-label="Paste from clipboard"
            className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl text-muted hover:bg-surface2 hover:text-fg"
          >
            <ClipboardPaste className="h-5 w-5" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={() => setLang((l) => (l === "en-IN" ? "hi-IN" : "en-IN"))}
          aria-label={`Voice language: ${lang === "en-IN" ? "English" : "Hindi"}. Press to switch.`}
          className={cn("h-11 min-w-11 shrink-0 cursor-pointer rounded-xl px-2 text-xs font-bold text-muted hover:bg-surface2 hover:text-fg", !hero && "hidden sm:block")}
        >
          {lang === "en-IN" ? "EN" : "हि"}
        </button>
        <button
          type="button"
          onClick={toggleMic}
          aria-pressed={listening}
          aria-label={listening ? "Stop listening" : "Search by voice"}
          className={cn(
            "relative grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl hover:bg-surface2",
            listening ? "bg-bad/15 text-bad" : "text-muted hover:text-fg",
          )}
        >
          {listening && <span aria-hidden className="absolute inset-0 animate-ping rounded-xl bg-bad/25" />}
          <Mic className="relative h-5 w-5" aria-hidden />
        </button>
        <button
          type="submit"
          disabled={busy}
          aria-label="Search"
          className={cn("gradient-bg grid shrink-0 cursor-pointer place-items-center font-semibold shadow-glow hover:brightness-110 disabled:opacity-60", hero ? "h-12 rounded-2xl px-6" : "h-10 w-10 rounded-xl")}
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : hero ? "Compare" : <Search className="h-5 w-5" aria-hidden />}
        </button>
      </div>

      {hero ? (
        <div role="radiogroup" aria-label="Where to search" className="mt-3 inline-flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              onClick={() => setMode(m.value)}
              className={cn("min-h-10 cursor-pointer rounded-lg px-3.5 text-sm font-semibold", mode === m.value ? "gradient-bg" : "text-muted hover:text-fg")}
            >
              {m.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-2">
          <label htmlFor={`${id}-mode`} className="sr-only">Where to search</label>
          <select
            id={`${id}-mode`}
            value={mode}
            onChange={(e) => setMode(e.target.value as SearchMode)}
            className="h-8 rounded-lg border border-line bg-surface2 px-2 text-xs font-medium text-muted"
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.value === "auto" ? "Auto-route" : m.label}</option>
            ))}
          </select>
          <p role="status" aria-live="polite" className="min-w-0 flex-1 truncate text-xs text-muted empty:hidden">{status}</p>
        </div>
      )}
      {hero && (
        <p role="status" aria-live="polite" className="mt-2 text-sm text-muted empty:hidden">
          {status}
        </p>
      )}
    </form>
  );
}

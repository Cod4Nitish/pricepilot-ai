"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPaste, Loader2, Mic, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchIntent, MODE_LABEL, type SearchMode } from "./discover-api";
import { queryFromLink } from "./SearchBar";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { LocationSelector, readSavedPincode } from "@/components/ui/location-selector";

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
  const [askLoc, setAskLoc] = useState(false);
  const pendingRef = useRef<{ text: string; overall: string } | null>(null);
  const recRef = useRef<SR | null>(null);
  const finalRef = useRef("");

  useEffect(() => () => recRef.current?.abort(), []);

  function openResults(text: string, chosen: string) {
    // E-Commerce goes to the /shop engine (recommendations, exact products, comparisons); Quick/Both stay on /discover.
    router.push(chosen === "ecommerce" ? `/shop?q=${encodeURIComponent(text)}` : `/discover?q=${encodeURIComponent(text)}&mode=${chosen}`);
  }

  async function go(raw: string) {
    const link = queryFromLink(raw);
    const text = (link ?? raw).trim();
    if (!text || busy) return;
    setBusy(true);
    setNote("");
    let chosen: string = mode;
    let overall: string = mode;
    if (mode === "auto") {
      try {
        const r = await fetchIntent(text);
        overall = r.overall;
        if (r.overall === "ecommerce") chosen = "ecommerce";
        const reason = r.items[0]?.reason ?? "";
        setRoute(`Searching ${MODE_LABEL[r.overall]}${r.items.length > 1 ? ` (${r.items.length} items)` : ""}${reason ? `: ${reason}` : ""}`);
      } catch {
        setRoute("Could not auto-route, so Discover will decide for you.");
      }
    } else {
      setRoute(`Searching ${MODE_LABEL[mode]} (your choice)`);
    }
    // Like Uber or Rapido: when local delivery matters and we do not know where you are, ask first.
    const needsLocation = overall === "quick" || overall === "both" || overall === "auto";
    if (needsLocation && !readSavedPincode()) {
      pendingRef.current = { text, overall: chosen };
      setAskLoc(true);
      setBusy(false);
      return;
    }
    openResults(text, chosen);
    setBusy(false);
  }

  function continueAfterLocation(skip: boolean) {
    const p = pendingRef.current;
    pendingRef.current = null;
    setAskLoc(false);
    if (!p) return;
    // Skipping location: only online stores can be compared.
    openResults(p.text, skip && p.overall !== "ecommerce" ? "ecommerce" : p.overall);
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
          hero ? "rounded-xl border border-line-strong bg-surface p-2 focus-within:border-primary" : "rounded-lg border border-line-strong bg-surface pr-1 focus-within:border-primary",
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
            placeholder={listening ? "Listening..." : hero ? "Search or speak…" : "Search or speak"}
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
            className="hidden h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl text-muted hover:bg-surface2 hover:text-fg sm:grid"
          >
            <ClipboardPaste className="h-5 w-5" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={() => setLang((l) => (l === "en-IN" ? "hi-IN" : "en-IN"))}
          aria-label={`Voice language: ${lang === "en-IN" ? "English" : "Hindi"}. Press to switch.`}
          className={cn("h-11 min-w-11 shrink-0 cursor-pointer rounded-xl px-2 text-xs font-bold text-muted hover:bg-surface2 hover:text-fg", "hidden sm:block")}
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
          className={cn("bg-primary text-white grid shrink-0 cursor-pointer place-items-center font-semibold disabled:opacity-60", hero ? "h-12 w-12 rounded-lg sm:w-auto sm:px-6" : "h-11 w-11 rounded-xl")}
        >
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          ) : hero ? (
            <>
              <span className="hidden sm:inline">Compare</span>
              <Search className="h-5 w-5 sm:hidden" aria-hidden />
            </>
          ) : (
            <Search className="h-5 w-5" aria-hidden />
          )}
        </button>
      </div>

      {/* Routing is automatic: no manual mode switch. The status line explains what was chosen. */}
      <p role="status" aria-live="polite" className={cn("text-muted empty:hidden", hero ? "mt-2 text-sm" : "mt-1 truncate text-xs")}>
        {status}
      </p>
      <Sheet open={askLoc} onClose={() => continueAfterLocation(true)} title="Where should we check delivery?">
        <p className="mb-4 text-sm text-muted">
          Quick-delivery stores show different prices and stock in each area. Allow your location once and we will check what is available near you.
        </p>
        <LocationSelector onChange={(pin) => pin && continueAfterLocation(false)} />
        <Button type="button" variant="ghost" className="mt-3 w-full" onClick={() => continueAfterLocation(true)}>
          Skip, compare online stores only
        </Button>
      </Sheet>
    </form>
  );
}

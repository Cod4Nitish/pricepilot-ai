"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const KEY = "pricepilot-install-dismissed";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return ios && safari;
}

function ShareIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="inline h-4 w-4 align-text-bottom"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 16V3M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
    </svg>
  );
}

export function InstallInstructions({ className = "" }: { className?: string }) {
  const card = "rounded-xl border border-line-strong bg-surface p-4";
  return (
    <div className={`grid gap-3 text-sm text-muted ${className}`}>
      <section className={card} aria-labelledby="install-android">
        <h3 id="install-android" className="mb-2 font-semibold text-fg">
          Android Chrome
        </h3>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open PricePilot in Chrome.</li>
          <li>Tap the menu (three dots).</li>
          <li>
            Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
          </li>
        </ol>
      </section>
      <section className={card} aria-labelledby="install-ios">
        <h3 id="install-ios" className="mb-2 font-semibold text-fg">
          iPhone Safari
        </h3>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open PricePilot in Safari.</li>
          <li>
            Tap the Share icon <ShareIcon /> in the toolbar.
          </li>
          <li>
            Scroll and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
          </li>
        </ol>
      </section>
      <section className={card} aria-labelledby="install-desktop">
        <h3 id="install-desktop" className="mb-2 font-semibold text-fg">
          Desktop Chrome / Edge
        </h3>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open PricePilot in Chrome or Edge.</li>
          <li>Click the install icon at the right of the address bar.</li>
          <li>
            Click <strong>Install</strong>.
          </li>
        </ol>
      </section>
    </div>
  );
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (isStandalone()) return;
    try {
      if (localStorage.getItem(KEY)) return;
    } catch {
      /* storage unavailable: still show */
    }
    setHidden(false);
    setIos(isIosSafari());

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* ignore */
    }
    setDeferred(null);
    setHidden(true);
  };

  const visible = !(hidden || (!deferred && !ios));
  // Tell the layout to reserve space so the prompt never covers primary content.
  useEffect(() => {
    if (!visible) return;
    document.documentElement.setAttribute("data-install", "");
    return () => document.documentElement.removeAttribute("data-install");
  }, [visible]);

  // Render only when there is something actionable.
  if (!visible) return null;

  return (
    <aside
      aria-label="Install PricePilot"
      className="fixed inset-x-2 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] z-[45] mx-auto max-w-md rounded-2xl border border-line-strong bg-surface p-2 pl-3 text-fg shadow-[3px_3px_0_var(--ink-edge)] lg:inset-x-auto lg:bottom-4 lg:right-4 lg:mx-0 lg:w-72"
    >
      <div className="flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">Install PricePilot</p>
          {deferred ? (
            <p className="text-xs leading-tight text-muted">Open it like an app.</p>
          ) : (
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-muted">
              <li>
                Tap the Share icon <ShareIcon />
              </li>
              <li>
                Choose <strong>Add to Home Screen</strong>
              </li>
            </ol>
          )}
        </div>
        {deferred && (
          <button
            type="button"
            onClick={install}
            className="min-h-10 shrink-0 cursor-pointer rounded-full bg-primary px-3 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-md text-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </aside>
  );
}

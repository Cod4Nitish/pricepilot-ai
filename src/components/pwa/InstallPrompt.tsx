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
  const card = "rounded-xl border border-[#27325f] bg-[#0F1A3A] p-4";
  return (
    <div className={`grid gap-3 text-sm text-slate-300 ${className}`}>
      <section className={card} aria-labelledby="install-android">
        <h3 id="install-android" className="mb-2 font-semibold text-white">
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
        <h3 id="install-ios" className="mb-2 font-semibold text-white">
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
        <h3 id="install-desktop" className="mb-2 font-semibold text-white">
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
      className="fixed inset-x-2 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.5rem)] z-[45] mx-auto max-w-md rounded-2xl border border-[#3a4a85] bg-[#0F1A3A] p-3 text-white shadow-2xl lg:inset-x-auto lg:bottom-4 lg:right-4 lg:mx-0 lg:w-80 lg:p-4"
    >
      <div className="flex items-start gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" width={44} height={44} className="h-11 w-11 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Install PricePilot</p>
          {deferred ? (
            <p className="mt-0.5 text-sm text-slate-300">
              Add it to your device for quick access to price checks.
            </p>
          ) : (
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-slate-300">
              <li>
                Tap the Share icon <ShareIcon />
              </li>
              <li>
                Choose <strong>Add to Home Screen</strong>
              </li>
            </ol>
          )}
          {deferred && (
            <button
              type="button"
              onClick={install}
              className="mt-2 min-h-11 rounded-lg bg-gradient-to-r from-[#2D8CFF] to-[#9B5CFF] px-4 py-2 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Install app
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md text-slate-300 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </aside>
  );
}

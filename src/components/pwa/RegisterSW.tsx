"use client";

import { useCallback, useEffect, useState } from "react";

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export default function RegisterSW() {
  const online = useOnlineStatus();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const devOptIn = new URLSearchParams(window.location.search).get("sw") === "1";
    if (process.env.NODE_ENV !== "production" && !devOptIn) return;

    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    const track = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) setWaiting(sw);
        });
      });
    };

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(track)
      .catch(() => undefined);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  const reload = useCallback(() => {
    if (waiting) waiting.postMessage("SKIP_WAITING");
    else window.location.reload();
  }, [waiting]);

  return (
    <>
      {!online && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 top-0 z-[100] bg-amber-500 px-4 py-2 text-center text-sm font-medium text-[#1a1200] shadow-lg"
        >
          You are offline — showing cached data with timestamps. Live prices unavailable.
        </div>
      )}
      {waiting && (
        <div
          role="alert"
          className="fixed inset-x-3 bottom-4 z-[100] mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-[#3a4a85] bg-[#0F1A3A] px-4 py-3 text-sm text-white shadow-2xl"
        >
          <span>Update available</span>
          <button
            type="button"
            onClick={reload}
            className="rounded-lg bg-gradient-to-r from-[#2D8CFF] to-[#9B5CFF] px-3 py-1.5 font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            Reload
          </button>
        </div>
      )}
    </>
  );
}

"use client";
import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { LocationSelector, PINCODE_KEY, readSavedPincode } from "@/components/ui/location-selector";

/** Header chip showing the saved delivery pincode; opens the location sheet. */
export default function LocationChip({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState<string | null>(null);

  useEffect(() => {
    setPin(readSavedPincode());
    const onStorage = (e: StorageEvent) => {
      if (e.key === PINCODE_KEY || e.key === null) setPin(readSavedPincode());
    };
    window.addEventListener("storage", onStorage);
    // Same-tab saves (e.g. from the search location prompt) do not fire "storage"; re-read cheaply.
    const t = setInterval(() => setPin((cur) => { const v = readSavedPincode(); return v === cur ? cur : v; }), 1000);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(t);
    };
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={pin ? `Delivery location ${pin}. Change` : "Set delivery location"}
        className={cn(
          "inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium text-fg hover:bg-surface2",
          className,
        )}
      >
        <MapPin className="h-4 w-4 text-primary" aria-hidden />
        <span className="tabular">{pin ?? "Set location"}</span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Delivery location">
        <LocationSelector onChange={(p) => setPin(p)} />
      </Sheet>
    </>
  );
}

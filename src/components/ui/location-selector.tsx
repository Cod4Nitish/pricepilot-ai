"use client";
import { useEffect, useId, useState } from "react";
import { Loader2, LocateFixed, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Input } from "./input";

export const PINCODE_KEY = "pricepilot:pincode";
const PIN_RE = /^[1-9][0-9]{5}$/;

export function isValidPincode(v: string): boolean {
  return PIN_RE.test(v.trim());
}

/** Read the saved pincode (client only). Returns null if none or storage is blocked. */
export function readSavedPincode(): string | null {
  try {
    const v = localStorage.getItem(PINCODE_KEY);
    return v && isValidPincode(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Pincode input: 6 digits (Indian PIN, cannot start with 0). The value is stored in this
 * browser's localStorage ONLY after the user presses Save, and the consent text says so.
 */
export function LocationSelector({
  onChange,
  className,
}: {
  onChange?: (pincode: string | null) => void;
  className?: string;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);

  useEffect(() => {
    const s = readSavedPincode();
    if (s) {
      setSaved(s);
      setValue(s);
      onChange?.(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const valid = isValidPincode(value);
  const showError = touched && value.length > 0 && !valid;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    const v = value.trim();
    try {
      localStorage.setItem(PINCODE_KEY, v);
    } catch {
      /* storage blocked: keep in memory only */
    }
    setSaved(v);
    onChange?.(v);
  }
  function persist(v: string) {
    try {
      localStorage.setItem(PINCODE_KEY, v);
    } catch {
      /* storage blocked: keep in memory only */
    }
    setValue(v);
    setSaved(v);
    onChange?.(v);
  }

  /** One-tap: ask the browser for permission, resolve to a pincode, save it on this device. */
  function useMyLocation() {
    setGeoMsg(null);
    if (!("geolocation" in navigator)) {
      setGeoMsg("This browser cannot share location. Enter your pincode instead.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const r = await fetch(`/api/geo/pincode?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
          const j = await r.json();
          if (!r.ok) throw new Error(j?.error?.message ?? "Lookup failed");
          persist(j.pincode as string);
          setGeoMsg(j.area ? `Detected ${j.area} (${j.pincode}). Edit it if this is not your delivery address.` : `Detected ${j.pincode}.`);
        } catch (err) {
          setGeoMsg(err instanceof Error ? err.message : "Could not detect your pincode. Enter it manually.");
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        setGeoMsg(err.code === err.PERMISSION_DENIED ? "Location permission was denied. You can enter your pincode instead." : "Could not get your location. Enter your pincode instead.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  function clear() {
    try {
      localStorage.removeItem(PINCODE_KEY);
    } catch {
      /* ignore */
    }
    setSaved(null);
    setValue("");
    setTouched(false);
    onChange?.(null);
  }

  return (
    <form onSubmit={save} className={cn("space-y-2", className)} noValidate>
      <Button type="button" onClick={useMyLocation} disabled={locating} className="w-full sm:w-auto">
        {locating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LocateFixed className="h-4 w-4" aria-hidden />}
        {locating ? "Finding your location…" : "Use my location"}
      </Button>
      {geoMsg && (
        <p role="status" className="text-xs text-muted">
          {geoMsg}
        </p>
      )}
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-semibold">
        <MapPin className="h-4 w-4 text-primary" aria-hidden /> Or enter pincode
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => {
            setValue(e.target.value.replace(/\D/g, "").slice(0, 6));
            setTouched(true);
          }}
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          placeholder="6-digit pincode"
          aria-invalid={showError}
          aria-describedby={`${id}-help`}
        />
        <Button type="submit" variant="secondary" disabled={!valid}>
          Save
        </Button>
      </div>
      <p id={`${id}-help`} role={showError ? "alert" : undefined} className={cn("text-xs", showError ? "font-medium text-bad" : "text-muted")}>
        {showError
          ? "Enter a valid 6-digit pincode (it cannot start with 0)."
          : "Your location is used once to find the pincode and is not stored on our servers. The pincode is saved only in this browser so delivery availability can be checked. Remove it any time."}
      </p>
      {saved && (
        <p role="status" className="flex items-center gap-2 text-xs text-good">
          Saved: <span className="font-semibold tabular">{saved}</span>
          <button type="button" onClick={clear} className="min-h-8 cursor-pointer px-1 text-primary underline">
            Remove
          </button>
        </p>
      )}
    </form>
  );
}

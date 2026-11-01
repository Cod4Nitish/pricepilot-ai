"use client";
import { useEffect, useId, useState } from "react";
import { MapPin } from "lucide-react";
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
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-semibold">
        <MapPin className="h-4 w-4 text-primary" aria-hidden /> Delivery pincode
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
          : "Pressing Save stores your pincode only in this browser (localStorage) so local availability can be checked. Remove it any time."}
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

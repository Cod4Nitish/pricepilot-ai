"use client";
import { HardDrive } from "lucide-react";
import { supabaseConfigured } from "@/lib/supabase-browser";

export default function LocalOnlyNote() {
  return (
    <p role="note" className="flex items-start gap-2 rounded-xl border border-line bg-surface2 px-3 py-2 text-sm text-fg">
      <HardDrive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>
        Saved on this browser/device only. Clearing browser data removes it. Not synced across devices.
        {supabaseConfigured && <span className="block text-xs text-muted">Account sync is not used for saved items.</span>}
      </span>
    </p>
  );
}

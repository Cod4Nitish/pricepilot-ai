import { BadgeCheck, Bot, FileText, HelpCircle } from "lucide-react";
import type { Verification } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

export const VERIFICATION_META: Record<
  Verification,
  { label: string; tone: "good" | "brand" | "warn" | "neutral"; Icon: typeof BadgeCheck; text: string }
> = {
  verified: { label: "Verified", tone: "good", Icon: BadgeCheck, text: "Price read from the retailer's product page" },
  agent_verified: { label: "Agent verified", tone: "brand", Icon: Bot, text: "Price read by a web agent on the live page" },
  snippet_only: { label: "Snippet only", tone: "warn", Icon: FileText, text: "Seen in a search snippet; page not confirmed" },
  unverified: { label: "Unverified", tone: "neutral", Icon: HelpCircle, text: "Could not be confirmed" },
};

/** Icon + text label (never colour only). `detail` adds the visible explanation, no tooltip needed. */
export default function VerificationBadge({ value, detail }: { value: Verification; detail?: boolean }) {
  const m = VERIFICATION_META[value];
  const badge = (
    <Badge tone={m.tone} title={m.text}>
      <m.Icon className="h-3.5 w-3.5" aria-hidden />
      {m.label}
    </Badge>
  );
  if (!detail) return badge;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {badge}
      <span className="text-xs text-muted">{m.text}</span>
    </span>
  );
}

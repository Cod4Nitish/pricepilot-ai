import { BadgeCheck, Bot, FileText, HelpCircle } from "lucide-react";
import type { Verification } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

const MAP: Record<Verification, { label: string; tone: "good" | "brand" | "warn" | "neutral"; Icon: typeof BadgeCheck; title: string }> = {
  verified: { label: "Verified", tone: "good", Icon: BadgeCheck, title: "Price read from the retailer's product page" },
  agent_verified: { label: "Agent verified", tone: "brand", Icon: Bot, title: "Price read by a web agent on the live page" },
  snippet_only: { label: "Snippet only", tone: "warn", Icon: FileText, title: "Seen in a search snippet; page not confirmed" },
  unverified: { label: "Unverified", tone: "neutral", Icon: HelpCircle, title: "Could not be confirmed" },
};

export default function VerificationBadge({ value }: { value: Verification }) {
  const m = MAP[value];
  return (
    <Badge tone={m.tone} title={m.title}>
      <m.Icon className="h-3.5 w-3.5" aria-hidden />
      {m.label}
    </Badge>
  );
}

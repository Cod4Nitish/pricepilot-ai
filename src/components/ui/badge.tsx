import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "border-line bg-surface2 text-muted",
      good: "border-good/30 bg-good/10 text-good",
      warn: "border-warn/30 bg-warn/10 text-warn",
      bad: "border-bad/30 bg-bad/10 text-bad",
      brand: "border-primary/30 bg-primary/10 text-primary",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

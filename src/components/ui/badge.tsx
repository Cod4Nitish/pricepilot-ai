import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold leading-none", {
  variants: {
    tone: {
      neutral: "border-line-strong bg-surface2 text-muted",
      good: "border-good/40 bg-good/10 text-good",
      warn: "border-warn/40 bg-warn/10 text-warn",
      bad: "border-bad/40 bg-bad/10 text-bad",
      brand: "border-primary/40 bg-primary/10 text-primary",
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

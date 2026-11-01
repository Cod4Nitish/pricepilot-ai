import * as React from "react";
import { cn } from "@/lib/utils";

/** Surface card. `level` maps to the elevation tokens (surface-1..3). */
export function Card({
  className,
  level = 1,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { level?: 1 | 2 | 3 }) {
  return (
    <div
      className={cn(
        "rounded-[1.1rem] border border-line-strong/40 p-4 shadow-card sm:p-5",
        level === 1 && "bg-surface",
        level === 2 && "bg-surface2",
        level === 3 && "bg-surface3",
        className,
      )}
      {...props}
    />
  );
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-display text-base font-semibold tracking-tight", className)} {...props} />;
}

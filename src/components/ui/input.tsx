import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-xl border border-line-strong bg-surface2 px-4 text-base text-fg placeholder:text-muted aria-[invalid=true]:border-bad focus:border-primary sm:text-sm",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

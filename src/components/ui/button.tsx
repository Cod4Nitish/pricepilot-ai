import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-[transform,filter,background-color,border-color,color] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none",
  {
    variants: {
      variant: {
        primary: "gradient-bg shadow-glow hover:brightness-110",
        secondary: "bg-surface2 text-fg border border-line-strong hover:border-primary/60 hover:bg-surface3",
        ghost: "text-muted hover:text-fg hover:bg-surface2",
        danger: "bg-bad/10 text-bad border border-bad/40 hover:bg-bad/20",
        verified: "bg-good/10 text-good border border-good/40 hover:bg-good/20",
      },
      size: { sm: "h-10 px-3.5", md: "h-11 px-5", lg: "h-12 px-7 text-base", icon: "h-11 w-11" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = "Button";

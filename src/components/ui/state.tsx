import * as React from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  children,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-dashed border-line-strong bg-surface p-8 text-center", className)}>
      <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-surface2 text-primary">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      {children && <div className="mx-auto mt-1.5 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("rounded-2xl border border-bad/50 bg-bad/5 p-5", className)}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-bad" aria-hidden />
        <div className="space-y-2">
          <h2 className="font-display font-semibold">{title}</h2>
          {message && <p className="text-sm text-muted">{message}</p>}
          {onRetry && (
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

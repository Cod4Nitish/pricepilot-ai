import { Skeleton } from "@/components/ui/skeleton";

export function ResultsSkeleton({ note }: { note?: string }) {
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
      {note && <p className="text-sm text-muted">{note}</p>}
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-4 rounded-2xl border border-line bg-surface p-5">
          <Skeleton className="h-32 w-32 shrink-0" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-5 w-4/5" />
            <Skeleton className="h-8 w-1/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

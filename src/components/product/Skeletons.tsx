import { Skeleton } from "@/components/ui/skeleton";

export function CardSkeleton() {
  return (
    <div className="flex gap-3 rounded-2xl border border-line bg-surface p-4">
      <Skeleton className="h-24 w-24 shrink-0 sm:h-32 sm:w-32" />
      <div className="flex-1 space-y-3">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-8 w-1/4" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

export function ResultsSkeleton({ note }: { note?: string }) {
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <span className="sr-only">Loading</span>
      {note && <p className="text-sm text-muted">{note}</p>}
      {[0, 1, 2].map((i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

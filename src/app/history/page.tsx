import { Suspense } from "react";
import type { Metadata } from "next";
import HistoryView from "./HistoryView";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Price history" };

export default function HistoryPage() {
  return (
    <Suspense fallback={<Skeleton className="h-80 w-full" />}>
      <HistoryView />
    </Suspense>
  );
}

import { Suspense } from "react";
import type { Metadata } from "next";
import SavedReportView from "./SavedReportView";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Saved research" };

export default function SavedReportPage() {
  return (
    <Suspense fallback={<Skeleton className="h-80 w-full" />}>
      <SavedReportView />
    </Suspense>
  );
}

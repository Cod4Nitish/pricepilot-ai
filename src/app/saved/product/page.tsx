import { Suspense } from "react";
import type { Metadata } from "next";
import SavedProductView from "./SavedProductView";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Saved product" };

export default function SavedProductPage() {
  return (
    <Suspense fallback={<Skeleton className="h-80 w-full" />}>
      <SavedProductView />
    </Suspense>
  );
}

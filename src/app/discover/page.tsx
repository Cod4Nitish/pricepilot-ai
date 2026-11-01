import { Suspense } from "react";
import type { Metadata } from "next";
import DiscoverView from "./DiscoverView";
import { ResultsSkeleton } from "@/components/product/Skeletons";

export const metadata: Metadata = { title: "Discover" };

export default function DiscoverPage() {
  return (
    <Suspense fallback={<ResultsSkeleton />}>
      <DiscoverView />
    </Suspense>
  );
}

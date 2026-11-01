import { Suspense } from "react";
import type { Metadata } from "next";
import SearchView from "./SearchView";
import { ResultsSkeleton } from "@/components/product/Skeletons";

export const metadata: Metadata = { title: "Search" };

export default function SearchPage() {
  return (
    <Suspense fallback={<ResultsSkeleton />}>
      <SearchView />
    </Suspense>
  );
}

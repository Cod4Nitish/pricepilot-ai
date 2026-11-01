"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import SearchBar from "@/components/layout/SearchBar";
import SearchResults from "@/components/product/SearchResults";
import ErrorCard from "@/components/product/ErrorCard";
import { ResultsSkeleton } from "@/components/product/Skeletons";
import { useSearch } from "@/components/product/useSearch";

export default function SearchView() {
  const params = useSearchParams();
  const router = useRouter();
  const q = (params.get("q") ?? "").trim();
  const search = useSearch(q);

  return (
    <div className="space-y-6">
      <div className="sticky top-[calc(env(safe-area-inset-top)+4.25rem)] z-20 -mx-4 bg-bg/80 px-4 py-2 backdrop-blur-xl sm:mx-0 sm:px-0">
        <SearchBar key={q} initial={q} onSubmitQuery={(v) => router.push(`/search?q=${encodeURIComponent(v)}`)} />
      </div>

      {!q && (
        <div className="py-16 text-center text-muted">
          <Search className="mx-auto mb-3 h-10 w-10" aria-hidden />
          <p>Search for a product to compare live prices across retailers.</p>
        </div>
      )}
      {q && search.isPending && <ResultsSkeleton note="Checking retailers live. This can take up to a minute." />}
      {q && search.isError && <ErrorCard error={search.error} onRetry={() => search.refetch()} />}
      {q && search.data && <SearchResults data={search.data} />}
    </div>
  );
}

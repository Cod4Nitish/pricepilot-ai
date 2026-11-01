"use client";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { EmptyState } from "@/components/ui/state";
import SearchResults from "@/components/product/SearchResults";
import ErrorCard from "@/components/product/ErrorCard";
import { ResultsSkeleton } from "@/components/product/Skeletons";
import { useSearch } from "@/components/product/useSearch";

export default function SearchView() {
  const params = useSearchParams();
    const q = (params.get("q") ?? "").trim();
  const search = useSearch(q);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-h1 font-bold">{q ? <>Results for “{q}”</> : "Search products"}</h1>
      {!q && (
        <EmptyState icon={Search} title="Search for a product">
          Type a product name or paste a link to compare live prices across retailers. Each price is labelled with how it was verified.
        </EmptyState>
      )}
      {q && search.isPending && <ResultsSkeleton note="Checking retailers live. This can take up to a minute." />}
      {q && search.isError && <ErrorCard error={search.error} onRetry={() => search.refetch()} />}
      {q && search.data && <SearchResults data={search.data} />}
    </div>
  );
}

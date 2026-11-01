"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { EmptyState } from "@/components/ui/state";
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
      <h1 className="font-display text-h1 font-bold">{q ? <>Results for “{q}”</> : "Search products"}</h1>
      <div className="-mx-4 px-4 sm:mx-0 sm:px-0">
        <SearchBar key={q} initial={q} onSubmitQuery={(v) => router.push(`/search?q=${encodeURIComponent(v)}`)} />
      </div>

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

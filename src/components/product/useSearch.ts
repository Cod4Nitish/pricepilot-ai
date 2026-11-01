"use client";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, saveLastSearch } from "@/lib/api-client";

export function useSearch(query: string) {
  const q = useQuery({
    queryKey: ["search", query.trim().toLowerCase()],
    queryFn: () => api.search(query.trim()),
    enabled: query.trim().length > 0,
  });
  useEffect(() => {
    if (q.data) saveLastSearch(q.data);
  }, [q.data]);
  return q;
}

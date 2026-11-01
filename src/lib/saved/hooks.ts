"use client";
// React bindings for the local saved store, using the project's TanStack Query pattern.
// All queries here read IndexedDB only (networkMode "always" so they also work offline). No /api calls.
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { onSavedChange, savedDb } from "./db";

export const SAVED_KEY = ["saved-local"] as const;

/** Re-read saved data whenever it changes in this tab or another tab. */
export function useSavedSync() {
  const qc = useQueryClient();
  useEffect(() => onSavedChange(() => void qc.invalidateQueries({ queryKey: SAVED_KEY })), [qc]);
}

const local = { networkMode: "always" as const, staleTime: 0, retry: false };

export function useSavedProducts() {
  useSavedSync();
  return useQuery({ queryKey: [...SAVED_KEY, "products"], queryFn: savedDb.listProducts, ...local });
}
export function useSavedReports() {
  useSavedSync();
  return useQuery({ queryKey: [...SAVED_KEY, "reports"], queryFn: savedDb.listReports, ...local });
}
export function useSavedProduct(id: string | null) {
  useSavedSync();
  return useQuery({ queryKey: [...SAVED_KEY, "product", id], queryFn: () => savedDb.getProduct(id!), enabled: !!id, ...local });
}
export function useSavedReport(id: string | null) {
  useSavedSync();
  return useQuery({ queryKey: [...SAVED_KEY, "report", id], queryFn: () => savedDb.getReport(id!), enabled: !!id, ...local });
}

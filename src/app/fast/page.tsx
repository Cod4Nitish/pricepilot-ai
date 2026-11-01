import { Suspense } from "react";
import type { Metadata } from "next";
import { FastView } from "@/components/fast/FastView";

export const metadata: Metadata = { title: "Fast Commerce - Blinkit vs Zepto" };

export default function FastPage() {
  return (
    <Suspense fallback={null}>
      <FastView />
    </Suspense>
  );
}

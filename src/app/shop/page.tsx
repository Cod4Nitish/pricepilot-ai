import { Suspense } from "react";
import type { Metadata } from "next";
import ShopView from "@/components/shop/ShopView";
import { ShopLoading } from "@/components/shop/ShopSkeletons";

export const metadata: Metadata = { title: "Shop search" };

export default function ShopPage() {
  return (
    <Suspense fallback={<ShopLoading />}>
      <ShopView />
    </Suspense>
  );
}

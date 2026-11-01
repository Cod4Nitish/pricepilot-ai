import { Suspense } from "react";
import type { Metadata } from "next";
import { BattleView } from "@/components/battle/BattleView";

export const metadata: Metadata = { title: "Live Deal Battle - Blinkit vs Zepto" };

export default function BattlePage() {
  return (
    <Suspense fallback={null}>
      <BattleView />
    </Suspense>
  );
}

import type { Category } from "../types";
import { laptopConfig } from "./laptop";
import { smartphoneConfig } from "./smartphone";
import type { CategoryConfig } from "./scoring";

export * from "./scoring";
export { smartphoneConfig, laptopConfig };

const REGISTRY: Partial<Record<Category, CategoryConfig>> = { smartphone: smartphoneConfig, laptop: laptopConfig };

/** Returns null for categories without a scoring config (no guessing for them). */
export function getCategoryConfig(c: Category): CategoryConfig | null {
  return REGISTRY[c] ?? null;
}
export function supportedCategories(): Category[] {
  return Object.keys(REGISTRY) as Category[];
}

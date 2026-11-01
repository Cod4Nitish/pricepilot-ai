import type { Category } from "../types";
import { headphonesConfig } from "./headphones";
import { laptopConfig } from "./laptop";
import { smartphoneConfig } from "./smartphone";
import { tvConfig } from "./tv";
import type { CategoryConfig } from "./scoring";

export * from "./scoring";
export { smartphoneConfig, laptopConfig, headphonesConfig, tvConfig };

const REGISTRY: Partial<Record<Category, CategoryConfig>> = { smartphone: smartphoneConfig, laptop: laptopConfig, headphones: headphonesConfig, tv: tvConfig };

/** Returns null for categories without a scoring config (no guessing for them). */
export function getCategoryConfig(c: Category): CategoryConfig | null {
  return REGISTRY[c] ?? null;
}
export function supportedCategories(): Category[] {
  return Object.keys(REGISTRY) as Category[];
}
/** True when "best X under Y" recommendations are supported for this category. */
export function isRecommendationSupported(c: Category): boolean {
  return c in REGISTRY;
}
/** Honest empty-state message for unsupported categories (for the discovery layer to surface). */
export function unsupportedCategoryMessage(c: Category): string {
  return `Recommendations for this category are not supported yet; try a specific ${c === "other" ? "product" : c} model. Currently supported: ${supportedCategories().join(", ")}.`;
}

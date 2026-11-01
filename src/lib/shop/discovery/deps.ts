import { getEnv } from "@/lib/env";
import { makeAnthropicLlm } from "./llm";
import type { BuildDecisionFn, BuildOffersFn, LlmFn, ShopDeps } from "./types";

export function resolveLlm(deps: ShopDeps): LlmFn | null {
  if (deps.llm) return deps.llm;
  const key = deps.anthropicKey === undefined ? getEnv().ANTHROPIC_API_KEY : deps.anthropicKey;
  return key ? makeAnthropicLlm(key, deps.fetchImpl) : null;
}

export function resolveAnthropicKey(deps: ShopDeps): string | undefined {
  const key = deps.anthropicKey === undefined ? getEnv().ANTHROPIC_API_KEY : deps.anthropicKey;
  return key ?? undefined;
}

/** Real implementations (owned by the delivery/offers agent) are imported lazily; null when unavailable. */
export async function resolveBuildOffers(deps: ShopDeps): Promise<BuildOffersFn | null> {
  if (deps.buildOffers) return deps.buildOffers;
  try {
    // @ts-ignore module is delivered by another agent
    const m = (await import("@/lib/shop/offers")) as { buildOffers?: BuildOffersFn };
    return m.buildOffers ?? null;
  } catch {
    return null;
  }
}

export async function resolveBuildDecision(deps: ShopDeps): Promise<BuildDecisionFn | null> {
  if (deps.buildDecision) return deps.buildDecision;
  try {
    // @ts-ignore module is delivered by another agent
    const m = (await import("@/lib/shop/decision")) as { buildDecision?: BuildDecisionFn };
    return m.buildDecision ?? null;
  } catch {
    return null;
  }
}

// Unified offer schema shared by the e-commerce and quick-commerce engines.
// RULE: null means "unknown". Nothing in this module invents a default value.
import { z } from "zod";

export const UnitQuantitySchema = z.object({
  /** total in base units (g, ml, or unit count) */
  value: z.number().positive(),
  unit: z.enum(["g", "ml", "unit"]),
  raw: z.string(),
});
export type UnitQuantity = z.infer<typeof UnitQuantitySchema>;

export const VariantSchema = z.object({
  storageGb: z.number().nullable(),
  ramGb: z.number().nullable(),
  color: z.string().nullable(),
  size: z.string().nullable(),
  condition: z.enum(["new", "refurbished"]).nullable(),
  /** number of items/packs bundled in the listing (e.g. "pack of 2"), if stated */
  pack: z.number().nullable(),
});
export type Variant = z.infer<typeof VariantSchema>;

export const ConditionalDiscountSchema = z.object({
  text: z.string(),
  amount: z.number().nullable(),
  condition: z.string(),
  applied: z.literal(false),
  kind: z.enum(["bank", "coupon", "emi", "other"]).optional(),
  instruments: z.array(z.string()).optional(),
  code: z.string().nullable().optional(),
  minOrder: z.number().nullable().optional(),
});
export type ConditionalDiscount = z.infer<typeof ConditionalDiscountSchema>;

export const VerificationStatusSchema = z.enum(["verified", "agent_verified", "snippet_only", "unverified"]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const UnifiedOfferSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  brand: z.string().nullable(),
  variant: VariantSchema,
  unitQuantity: UnitQuantitySchema.nullable(),
  retailer: z.string(),
  commerceMode: z.enum(["ecommerce", "quick"]),
  sourceUrl: z.string(),
  locationId: z.string().nullable(),
  listedPrice: z.number().nullable(),
  mrp: z.number().nullable(),
  shippingFee: z.number().nullable(),
  handlingFee: z.number().nullable(),
  platformFee: z.number().nullable(),
  /** only discounts whose conditions are met (user selected matching instrument) */
  eligibleDiscount: z.number().nullable(),
  conditionalDiscounts: z.array(ConditionalDiscountSchema),
  stockStatus: z.enum(["in_stock", "out_of_stock", "unknown"]),
  deliveryEtaMinutes: z.number().nullable(),
  observedAt: z.string(),
  verificationStatus: VerificationStatusSchema,
  matchingConfidence: z.number().min(0).max(1),
  evidence: z.array(z.object({ text: z.string(), source: z.string() })),
  /** validated GTIN (14-digit normalised) when found on the page; extension to the base contract */
  gtin: z.string().nullable().optional(),
});
export type UnifiedOffer = z.infer<typeof UnifiedOfferSchema>;

export const ENGINE_VERSION = 1;

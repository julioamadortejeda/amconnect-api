import { z } from "zod";

// ─── Carrier ──────────────────────────────────────────────────────────────────

export const CarrierSchema = z.object({
  name: z.string().min(1),
  shortName: z.string().optional().nullable(),
  logoUrl: z.string().url().optional().nullable(),
});
export type CarrierDTO = z.infer<typeof CarrierSchema>;

// ─── Branch ───────────────────────────────────────────────────────────────────

export const BranchSchema = z.object({
  name: z.string().min(1),
  code: z.string().toUpperCase().optional().nullable(), // e.g. LIFE, GMM, AUTO
});
export type BranchDTO = z.infer<typeof BranchSchema>;

// ─── Product ──────────────────────────────────────────────────────────────────

export const ProductSchema = z.object({
  carrierId: z.string().uuid(),
  branchId: z.string().uuid(),
  name: z.string().min(1),
});
export type ProductDTO = z.infer<typeof ProductSchema>;

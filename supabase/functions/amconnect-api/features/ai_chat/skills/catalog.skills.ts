import { z } from "zod";
import { SkillDefinition } from "./skill.core.ts";

export const catalogSkills: SkillDefinition[] = [
  // ─── Carriers ────────────────────────────────────────────────────────────────

  {
    domain: "catalog",
    declaration: {
      name: "search_carrier",
      description: "Searches for the advisor's insurance carriers by name. ALWAYS call before create_carrier. If it returns at least one result, use the ID of the first one (highest similarity) and DO NOT call create_carrier. Only call create_carrier if the result is empty.",
      schema: z.object({
        query: z.string().optional().describe("Name of the carrier to search for (e.g., 'AXA', 'GNP', 'Metlife')"),
        name: z.string().optional().describe("Accepted alias of query"),
      }),
    },
    async execute(args, ctx) {
      const q = (args.query ?? args.name) as string | undefined;
      if (!q) return { error: "The name of the carrier to search for is required." };
      return await ctx.catalogServices.carrierService.search(q);
    },
  },
  {
    domain: "catalog",
    declaration: {
      name: "create_carrier",
      description: "Creates a new insurance carrier for the advisor. Use search_carrier first to check it doesn't already exist.",
      schema: z.object({
        name: z.string({ required_error: "The name of the carrier is required" })
          .describe("Full name of the carrier (e.g., 'AXA Seguros')"),
        short_name: z.string().optional()
          .describe("Abbreviation or short name (e.g., 'AXA', 'GNP', 'SMNYL')"),
      }),
    },
    async execute({ name, short_name }, ctx) {
      return await ctx.catalogServices.carrierService.create({ name, shortName: short_name });
    },
  },

  // ─── Branches (Ramos) ─────────────────────────────────────────────────────────

  {
    domain: "catalog",
    declaration: {
      name: "search_branch",
      description: "Searches for the advisor's branches (lines of business) by name. ALWAYS call before create_branch. If it returns at least one result, use the ID of the first one (highest similarity) and DO NOT call create_branch. Only call create_branch if the result is empty.",
      schema: z.object({
        query: z.string().optional().describe("Name of the branch (e.g., 'Vida', 'Gastos Médicos', 'Auto', 'Daños')"),
        name: z.string().optional().describe("Accepted alias of query"),
      }),
    },
    async execute(args, ctx) {
      const q = (args.query ?? args.name) as string | undefined;
      if (!q) return { error: "The name of the branch to search for is required." };
      return await ctx.catalogServices.branchService.search(q);
    },
  },
  {
    domain: "catalog",
    declaration: {
      name: "create_branch",
      description: "Creates a new branch for the advisor. Use search_branch first to check it doesn't already exist.",
      schema: z.object({
        name: z.string({ required_error: "The name of the branch is required" })
          .describe("Name of the branch in Spanish (e.g., 'Vida', 'Gastos Médicos Mayores', 'Auto')"),
        code: z.string({ required_error: "The uppercase English code of the branch is required" })
          .describe("Short uppercase English code derived from the name (e.g., 'LIFE' for Vida, 'GMM' for Gastos Médicos, 'AUTO' for Auto, 'DAMAGE' for Daños)"),
      }),
    },
    async execute({ name, code }, ctx) {
      return await ctx.catalogServices.branchService.create({ name, code });
    },
  },

  {
    domain: "catalog",
    declaration: {
      name: "update_carrier",
      description: "Updates data of an existing carrier. Use search_carrier first to obtain the carrier_id.",
      schema: z.object({
        carrier_id: z.string().optional().describe("UUID of the carrier to update (obtained from search_carrier)"),
        id: z.string().optional().describe("Accepted alias of carrier_id"),
        name: z.string().optional().describe("New name"),
        short_name: z.string().optional().describe("New abbreviation"),
      }),
    },
    async execute(args, ctx) {
      const carrierId = (args.carrier_id ?? args.id) as string | undefined;
      if (!carrierId) return { error: "The UUID of the carrier is required. Use search_carrier to obtain it." };
      return await ctx.catalogServices.carrierService.update(carrierId, {
        name: args.name,
        shortName: args.short_name,
      });
    },
  },
  {
    domain: "catalog",
    declaration: {
      name: "update_branch",
      description: "Updates data of an existing branch. Use search_branch first to obtain the branch_id.",
      schema: z.object({
        branch_id: z.string().optional().describe("UUID of the branch to update (obtained from search_branch)"),
        id: z.string().optional().describe("Accepted alias of branch_id"),
        name: z.string().optional().describe("New name"),
        code: z.string().optional().describe("New uppercase English code"),
      }),
    },
    async execute(args, ctx) {
      const branchId = (args.branch_id ?? args.id) as string | undefined;
      if (!branchId) return { error: "The UUID of the branch is required. Use search_branch to obtain it." };
      return await ctx.catalogServices.branchService.update(branchId, {
        name: args.name,
        code: args.code,
      });
    },
  },

  // ─── Products ─────────────────────────────────────────────────────────────────

  {
    domain: "catalog",
    declaration: {
      name: "get_products",
      description: "Lists all products of the advisor with their carrier and branch. Use when the user asks what products they have, or wants to see the products of a specific carrier.",
      schema: z.object({}),
    },
    async execute(_args, ctx) {
      return await ctx.catalogServices.productService.getWithRelations();
    },
  },
  {
    domain: "catalog",
    declaration: {
      name: "search_product",
      description: "Searches for insurance products of the advisor by name. ALWAYS call before create_product. If it returns at least one result, use the ID of the first one and DO NOT call create_product. Only call create_product if the result is empty.",
      schema: z.object({
        query: z.string().optional().describe("Name of the product to search for (e.g., 'Plan Familiar', 'Seguro de Vida Premium')"),
        name: z.string().optional().describe("Accepted alias of query"),
      }),
    },
    async execute(args, ctx) {
      const q = (args.query ?? args.name) as string | undefined;
      if (!q) return { error: "The name of the product to search for is required." };
      return await ctx.catalogServices.productService.search(q);
    },
  },
  {
    domain: "catalog",
    declaration: {
      name: "update_product",
      description: "Updates data of an existing product. Use search_product first to obtain the product_id.",
      schema: z.object({
        product_id: z.string().optional().describe("UUID of the product to update (obtained from search_product)"),
        id: z.string().optional().describe("Accepted alias of product_id"),
        name: z.string().optional().describe("New name of the product"),
        carrier_id: z.string().optional().describe("New carrier UUID"),
        branch_id: z.string().optional().describe("New branch UUID"),
      }),
    },
    async execute(args, ctx) {
      const productId = (args.product_id ?? args.id) as string | undefined;
      if (!productId) return { error: "The UUID of the product is required. Use search_product to obtain it." };
      return await ctx.catalogServices.productService.update(productId, {
        name: args.name,
        carrierId: args.carrier_id,
        branchId: args.branch_id,
      });
    },
  },
  {
    domain: "catalog",
    declaration: {
      name: "create_product",
      description: "Creates a new insurance product. Requires carrier_id and branch_id — use search_carrier and search_branch first to obtain them.",
      schema: z.object({
        name: z.string({ required_error: "The name of the product is required" })
          .describe("Name of the product (e.g., 'Plan Familiar Plus')"),
        carrier_id: z.string({ required_error: "The carrier UUID is required. Use search_carrier or create_carrier to obtain it." })
          .describe("UUID of the carrier (obtained from search_carrier or create_carrier)"),
        branch_id: z.string({ required_error: "The branch UUID is required. Use search_branch or create_branch to obtain it." })
          .describe("UUID of the branch (obtained from search_branch or create_branch)"),
      }),
    },
    async execute({ name, carrier_id, branch_id }, ctx) {
      return await ctx.catalogServices.productService.create({
        name,
        carrierId: carrier_id,
        branchId: branch_id,
      });
    },
  },
];

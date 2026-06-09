import { z } from "zod";
import { SkillDefinition } from "./skill.core.ts";

export const catalogSkills: SkillDefinition[] = [
  // ─── Carriers ────────────────────────────────────────────────────────────────

  {
    domain: "catalog",
    declaration: {
      name: "search_carrier",
      description: "Busca aseguradoras del asesor por nombre. SIEMPRE llamar antes de create_carrier. Si devuelve al menos un resultado, usar el id del primero (mayor similarity) y NO llamar create_carrier. Solo llamar create_carrier si el resultado está vacío.",
      schema: z.object({
        query: z.string().optional().describe("Nombre de la aseguradora a buscar (ej: 'AXA', 'GNP', 'Metlife')"),
        name: z.string().optional().describe("Alias aceptado de query"),
      }),
    },
    async execute(args, ctx) {
      const q = (args.query ?? args.name) as string | undefined;
      if (!q) return { error: "Se requiere el nombre de la aseguradora a buscar." };
      return await ctx.catalogServices.carrierService.search(q);
    },
  },
  {
    domain: "catalog",
    declaration: {
      name: "create_carrier",
      description: "Crea una nueva aseguradora para el asesor. Usar search_carrier primero para verificar que no exista.",
      schema: z.object({
        name: z.string({ required_error: "Se requiere el nombre de la aseguradora" })
          .describe("Nombre completo de la aseguradora (ej: 'AXA Seguros')"),
        short_name: z.string().optional()
          .describe("Abreviación o nombre corto (ej: 'AXA', 'GNP', 'SMNYL')"),
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
      description: "Busca ramos del asesor por nombre. SIEMPRE llamar antes de create_branch. Si devuelve al menos un resultado — aunque sean varios con el mismo nombre — usar el id del primero (mayor similarity) y NO llamar create_branch. Solo llamar create_branch si el resultado está vacío.",
      schema: z.object({
        query: z.string().optional().describe("Nombre del ramo (ej: 'Vida', 'Gastos Médicos', 'Auto', 'Daños')"),
        name: z.string().optional().describe("Alias aceptado de query"),
      }),
    },
    async execute(args, ctx) {
      const q = (args.query ?? args.name) as string | undefined;
      if (!q) return { error: "Se requiere el nombre del ramo a buscar." };
      return await ctx.catalogServices.branchService.search(q);
    },
  },
  {
    domain: "catalog",
    declaration: {
      name: "create_branch",
      description: "Crea un nuevo ramo para el asesor. Usar search_branch primero para verificar que no exista.",
      schema: z.object({
        name: z.string({ required_error: "Se requiere el nombre del ramo" })
          .describe("Nombre del ramo en español (ej: 'Vida', 'Gastos Médicos Mayores', 'Auto')"),
        code: z.string({ required_error: "Se requiere el código del ramo en inglés mayúsculas" })
          .describe("Código corto en inglés mayúsculas derivado del nombre (ej: 'LIFE' para Vida, 'GMM' para Gastos Médicos, 'AUTO' para Auto, 'DAMAGE' para Daños)"),
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
      description: "Actualiza datos de una aseguradora existente. Usar search_carrier primero para obtener el carrier_id.",
      schema: z.object({
        carrier_id: z.string().optional().describe("UUID de la aseguradora a actualizar (obtenido de search_carrier)"),
        id: z.string().optional().describe("Alias aceptado de carrier_id"),
        name: z.string().optional().describe("Nuevo nombre"),
        short_name: z.string().optional().describe("Nueva abreviación"),
      }),
    },
    async execute(args, ctx) {
      const carrierId = (args.carrier_id ?? args.id) as string | undefined;
      if (!carrierId) return { error: "Se requiere el UUID de la aseguradora. Usar search_carrier para obtenerlo." };
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
      description: "Actualiza datos de un ramo existente. Usar search_branch primero para obtener el branch_id.",
      schema: z.object({
        branch_id: z.string().optional().describe("UUID del ramo a actualizar (obtenido de search_branch)"),
        id: z.string().optional().describe("Alias aceptado de branch_id"),
        name: z.string().optional().describe("Nuevo nombre"),
        code: z.string().optional().describe("Nuevo código en inglés mayúsculas"),
      }),
    },
    async execute(args, ctx) {
      const branchId = (args.branch_id ?? args.id) as string | undefined;
      if (!branchId) return { error: "Se requiere el UUID del ramo. Usar search_branch para obtenerlo." };
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
      description: "Lista todos los productos del asesor con su aseguradora y ramo. Usar cuando el usuario pregunte qué productos tiene en cartera, o quiera ver los productos de una aseguradora específica.",
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
      description: "Busca productos de seguro del asesor por nombre. SIEMPRE llamar antes de create_product. Si devuelve al menos un resultado, usar el id del primero y NO llamar create_product. Solo llamar create_product si el resultado está vacío.",
      schema: z.object({
        query: z.string().optional().describe("Nombre del producto a buscar (ej: 'Plan Familiar', 'Seguro de Vida Premium')"),
        name: z.string().optional().describe("Alias aceptado de query"),
      }),
    },
    async execute(args, ctx) {
      const q = (args.query ?? args.name) as string | undefined;
      if (!q) return { error: "Se requiere el nombre del producto a buscar." };
      return await ctx.catalogServices.productService.search(q);
    },
  },
  {
    domain: "catalog",
    declaration: {
      name: "update_product",
      description: "Actualiza datos de un producto existente. Usar search_product primero para obtener el product_id.",
      schema: z.object({
        product_id: z.string().optional().describe("UUID del producto a actualizar (obtenido de search_product)"),
        id: z.string().optional().describe("Alias aceptado de product_id"),
        name: z.string().optional().describe("Nuevo nombre del producto"),
        carrier_id: z.string().optional().describe("Nuevo UUID de aseguradora"),
        branch_id: z.string().optional().describe("Nuevo UUID de ramo"),
      }),
    },
    async execute(args, ctx) {
      const productId = (args.product_id ?? args.id) as string | undefined;
      if (!productId) return { error: "Se requiere el UUID del producto. Usar search_product para obtenerlo." };
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
      description: "Crea un nuevo producto de seguro. Requiere carrier_id y branch_id — usar search_carrier y search_branch primero para obtenerlos.",
      schema: z.object({
        name: z.string({ required_error: "Se requiere el nombre del producto" })
          .describe("Nombre del producto (ej: 'Plan Familiar Plus')"),
        carrier_id: z.string({ required_error: "Se requiere el UUID de la aseguradora. Usar search_carrier o create_carrier para obtenerlo." })
          .describe("UUID de la aseguradora (obtenido de search_carrier o create_carrier)"),
        branch_id: z.string({ required_error: "Se requiere el UUID del ramo. Usar search_branch o create_branch para obtenerlo." })
          .describe("UUID del ramo (obtenido de search_branch o create_branch)"),
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

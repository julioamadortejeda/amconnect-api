import { Context } from "hono";
import { sendSuccess } from "../../shared/api_response.ts";
import { CatalogServices } from "../../modules/catalog/catalog.service.ts";
import { CarrierSchema, BranchSchema, ProductSchema } from "../../modules/catalog/catalog.dto.ts";

type CatalogKey = keyof CatalogServices;

// Controlador de solo lectura — catálogos globales
function makeReadController(serviceKey: CatalogKey) {
  return {
    async getAll(c: Context) {
      const services: CatalogServices = c.get("services").catalogServices;
      const data = await services[serviceKey].getAll();
      return sendSuccess(c, data);
    },
    async getById(c: Context) {
      const services: CatalogServices = c.get("services").catalogServices;
      const data = await services[serviceKey].getById(c.req.param("id") as string);
      return sendSuccess(c, data);
    },
  };
}

// Controlador CRUD — catálogos por agente
function makeAgentCatalogController(serviceKey: CatalogKey, schema: typeof CarrierSchema | typeof BranchSchema | typeof ProductSchema) {
  return {
    async getAll(c: Context) {
      const services: CatalogServices = c.get("services").catalogServices;
      const data = await services[serviceKey].getAll();
      return sendSuccess(c, data);
    },
    async getById(c: Context) {
      const services: CatalogServices = c.get("services").catalogServices;
      const data = await services[serviceKey].getById(c.req.param("id") as string);
      return sendSuccess(c, data);
    },
    async create(c: Context) {
      const body = schema.parse(await c.req.json());
      const services: CatalogServices = c.get("services").catalogServices;
      const data = await services[serviceKey].create(body as Record<string, unknown>);
      return sendSuccess(c, data, 201);
    },
    async update(c: Context) {
      const body = schema.partial().parse(await c.req.json());
      const services: CatalogServices = c.get("services").catalogServices;
      const data = await services[serviceKey].update(c.req.param("id") as string, body as Record<string, unknown>);
      return sendSuccess(c, data);
    },
    async remove(c: Context) {
      const services: CatalogServices = c.get("services").catalogServices;
      const data = await services[serviceKey].delete(c.req.param("id") as string);
      return sendSuccess(c, data);
    },
  };
}

export const CarrierController = makeAgentCatalogController("carrierService", CarrierSchema);
export const BranchController = makeAgentCatalogController("branchService", BranchSchema);
export const ProductController = makeAgentCatalogController("productService", ProductSchema);
export const CurrencyController = makeReadController("currencyService");
export const PaymentFrequencyController = makeReadController("paymentFrequencyService");
export const PaymentMethodController = makeReadController("paymentMethodService");
export const PolicyStatusController = makeReadController("policyStatusService");
export const ParticipantRoleController = makeReadController("participantRoleService");
export const ReminderTypeController = makeReadController("reminderTypeService");
export const ReminderStatusController = makeReadController("reminderStatusService");


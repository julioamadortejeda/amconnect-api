import { z } from "zod";
import { SkillDefinition } from "./skill.core.ts";

const slimContact = (c: Record<string, unknown>) => ({
  id: c.id,
  fullName: c.fullName,
  phone: c.phone,
  email: c.email,
  birthdate: c.birthdate,
  occupation: c.occupation,
  address: c.address,
  rfc: c.rfc,
  curp: c.curp,
  notes: c.notes,
});

export const contactSkills: SkillDefinition[] = [
  {
    domain: "contact",
    declaration: {
      name: "search_contact",
      description: "Busca contactos/clientes del asesor por nombre, email o cualquier texto.",
      schema: z.object({
        query: z.string({ required_error: "Se requiere un texto de búsqueda (nombre, email, etc.)" })
          .describe("Nombre, email o texto a buscar"),
      }),
    },
    async execute({ query }, ctx) {
      const results = await ctx.contactService.findSimilarContact(ctx.agentId, query as string);
      return (results ?? []).map((c) => slimContact(c as unknown as Record<string, unknown>));
    },
  },
  {
    domain: "contact",
    declaration: {
      name: "get_contact",
      description: "Obtiene los datos completos de un contacto por su ID.",
      schema: z.object({
        contact_id: z.string({ required_error: "Se requiere el UUID del contacto" })
          .describe("UUID del contacto"),
      }),
    },
    async execute({ contact_id }, ctx) {
      return await ctx.contactService.getById(contact_id as string);
    },
  },
  {
    domain: "contact",
    declaration: {
      name: "create_contact",
      description: "Crea un nuevo contacto/cliente.",
      schema: z.object({
        full_name: z.string({ required_error: "El nombre completo del contacto es obligatorio. Si el usuario no lo proporcionó, pregúntale antes de llamar este skill. NUNCA uses otro campo (CURP, RFC, email, etc.) como sustituto del nombre." })
          .describe("Nombre real de la persona tal como lo proporcionó el usuario. No inventar ni copiar de otros campos."),
        email: z.string().optional(),
        phone: z.string().optional(),
        birthdate: z.string().optional().describe("Fecha de nacimiento en formato YYYY-MM-DD. Usar exactamente 'birthdate', no 'birth_date'"),
        rfc: z.string().optional(),
        curp: z.string().optional(),
        address: z.string().optional(),
        occupation: z.string().optional(),
        notes: z.string().optional().describe("Notas sobre el contacto (enfermedades, preferencias, etc.)"),
      }),
    },
    async execute(args, ctx) {
      return await ctx.contactService.create({
        agentId: ctx.agentId,
        fullName: (args.full_name ?? args.name) as string,
        email: args.email as string ?? null,
        phone: args.phone as string ?? null,
        birthdate: (args.birthdate ?? args.birth_date) as string ?? null,
        rfc: args.rfc as string ?? null,
        curp: args.curp as string ?? null,
        address: args.address as string ?? null,
        occupation: args.occupation as string ?? null,
        notes: args.notes as string ?? null,
      });
    },
  },
  {
    domain: "contact",
    declaration: {
      name: "get_all_contacts",
      description: "Obtiene la lista completa de contactos/clientes del asesor. Usar solo cuando el usuario quiere VER los contactos, no para contarlos.",
      schema: z.object({}),
    },
    async execute(_args, ctx) {
      const contacts = await ctx.contactService.getByField("agent_id", ctx.agentId);
      return (contacts ?? []).map((c) => slimContact(c as unknown as Record<string, unknown>));
    },
  },
  {
    domain: "contact",
    declaration: {
      name: "count_contacts",
      description: "Cuenta cuántos contactos/clientes tiene el asesor. Usar cuando el usuario pregunta '¿cuántos clientes tengo?' o similares.",
      schema: z.object({}),
    },
    async execute(_args, ctx) {
      const count = await ctx.contactService.count({ agent_id: ctx.agentId });
      return { count };
    },
  },
  {
    domain: "contact",
    declaration: {
      name: "update_contact",
      description: "Actualiza datos de un contacto existente. Usar search_contact primero para obtener el contact_id si no se conoce.",
      schema: z.object({
        contact_id: z.string({ required_error: "Se requiere el UUID del contacto a actualizar. Usar search_contact primero si no se conoce." })
          .describe("UUID del contacto a actualizar"),
        full_name: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        birthdate: z.string().optional().describe("Fecha en formato YYYY-MM-DD"),
        rfc: z.string().optional(),
        curp: z.string().optional(),
        address: z.string().optional(),
        occupation: z.string().optional(),
        notes: z.string().optional(),
      }),
    },
    async execute(args, ctx) {
      return await ctx.contactService.update(args.contact_id as string, {
        fullName: (args.full_name ?? args.name) as string | undefined,
        email: args.email as string | undefined,
        phone: args.phone as string | undefined,
        birthdate: (args.birthdate ?? args.birth_date) as string | undefined,
        rfc: args.rfc as string | undefined,
        curp: args.curp as string | undefined,
        address: args.address as string | undefined,
        occupation: args.occupation as string | undefined,
        notes: args.notes as string | undefined,
      });
    },
  },
  {
    domain: "contact",
    declaration: {
      name: "search_contact_notes",
      description: "Busca notas sobre un contacto específico. Usar cuando la pregunta es sobre UN cliente en particular. Para búsqueda general de conocimiento sin contacto específico, usar search_knowledge.",
      schema: z.object({
        query: z.string({ required_error: "Se requiere el texto o pregunta a buscar en las notas" })
          .describe("Pregunta o tema a buscar en las notas"),
        contact_id: z.string().optional().describe("UUID del contacto (opcional, para filtrar)"),
      }),
    },
    async execute({ query, contact_id }, ctx) {
      return await ctx.ragService.searchNotes(ctx.agentId, query as string, {
        contactId: contact_id as string | undefined,
      });
    },
  },
];

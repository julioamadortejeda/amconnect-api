import { z } from "zod";
import { assertHasChanges, SkillDefinition } from "./skill.core.ts";
import { entityThreshold } from "../../rag/rag.service.ts";
import { clientNotResolved, contactCardResult, contactListResult } from "./contact.mapper.ts";

export const contactSkills: SkillDefinition[] = [
  {
    domain: "contact",
    declaration: {
      name: "search_contact",
      description: "Searches for the advisor's contacts/clients by name, email, or any text.",
      schema: z.object({
        query: z.string({ required_error: "A search query (name, email, etc.) is required" })
          .describe("Name, email, or text to search for"),
      }),
    },
    async execute({ query }, ctx) {
      const results = await ctx.contactService.findSimilarContact(ctx.agentId, query as string);
      return contactListResult(results);
    },
  },
  {
    domain: "contact",
    declaration: {
      name: "get_contact",
      // Corta a propósito: la descripción viaja en el esquema de tools de cada
      // petición. La versión larga que explicaba cuándo no usarla (2026-08-13)
      // no cambió el comportamiento del modelo y costaba ~100 tokens por turno.
      description:
        "Retrieves a contact's data by their UUID. Prefer search_contact when you have a name.",
      schema: z.object({
        contact_id: z.string({ required_error: "The contact UUID is required" })
          .describe("UUID of the contact"),
      }),
    },
    async execute({ contact_id }, ctx) {
      const contact = await ctx.contactService.getById(contact_id as string);
      if (!contact) return null;
      return contactCardResult(contact, "contact_info");
    },
  },
  {
    domain: "contact",
    declaration: {
      name: "create_contact",
      description: "Creates a new contact/client (by default, it creates a client, but if specified as a prospect, it will be created as one).",
      schema: z.object({
        full_name: z.string({ required_error: "The full name of the contact is required. If the user did not provide it, ask them before calling this skill. NEVER use another field (CURP, RFC, email, etc.) as a substitute for the name." })
          .describe("Real name of the person as provided by the user. Do not invent or copy from other fields."),
        email: z.string().optional(),
        phone: z.string().optional(),
        birthdate: z.string().optional().describe("Birthdate in YYYY-MM-DD format. Must use exactly 'birthdate', not 'birth_date'"),
        rfc: z.string().optional(),
        curp: z.string().optional(),
        address: z.string().optional(),
        occupation: z.string().optional(),
        notes: z.string().optional().describe("Notes about the contact (conditions, preferences, etc.)"),
        is_prospect: z.boolean().optional().describe("Set to true if they are a prospect, or false if they are a client. Defaults to false (client)."),
      }),
    },
    async execute(args, ctx) {
      const contact = await ctx.contactWorkflow.createWithNotes(
        ctx.agentId,
        ctx.sessionId,
        {
          agentId: ctx.agentId,
          fullName: (args.full_name ?? args.name) as string,
          email: args.email as string ?? null,
          phone: args.phone as string ?? null,
          birthdate: (args.birthdate ?? args.birth_date) as string ?? null,
          rfc: args.rfc as string ?? null,
          curp: args.curp as string ?? null,
          address: args.address as string ?? null,
          occupation: args.occupation as string ?? null,
          isProspect: args.is_prospect as boolean ?? false,
        },
        args.notes as string | undefined,
      );
      if (!contact) return null;
      return contactCardResult(contact, "contact_created");
    },
  },
  {
    domain: "contact",
    declaration: {
      name: "get_all_contacts",
      description: "Retrieves the complete list of the advisor's contacts/clients. Use only when the user wants to VIEW the contacts, not just count them.",
      schema: z.object({}),
    },
    async execute(_args, ctx) {
      const contacts = await ctx.contactService.getByField("agent_id", ctx.agentId);
      // Mismo criterio que search_contact: sin filas no hay tarjeta.
      return contactListResult(contacts);
    },
  },
  {
    domain: "contact",
    declaration: {
      name: "count_contacts",
      description: "Counts how many contacts/clients the advisor has. Use when the user asks 'how many clients do I have?' or similar.",
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
      description: "Updates data of an existing contact. Use search_contact first to obtain the contact_id if unknown. Does NOT handle notes — use add_note_to_client for that.",
      schema: z.object({
        contact_id: z.string({ required_error: "The UUID of the contact to update is required." })
          .describe("UUID of the contact to update, obtained from search_contact."),
        full_name: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        birthdate: z.string().optional().describe("Date in YYYY-MM-DD format"),
        rfc: z.string().optional(),
        curp: z.string().optional(),
        address: z.string().optional(),
        occupation: z.string().optional(),
      }),
    },
    async execute(args, ctx) {
      const changes = {
        fullName: (args.full_name ?? args.name) as string | undefined,
        email: args.email as string | undefined,
        phone: args.phone as string | undefined,
        birthdate: (args.birthdate ?? args.birth_date) as string | undefined,
        rfc: args.rfc as string | undefined,
        curp: args.curp as string | undefined,
        address: args.address as string | undefined,
        occupation: args.occupation as string | undefined,
      };
      assertHasChanges(changes);
      const updated = await ctx.contactService.update(args.contact_id as string, changes);
      if (!updated) return null;
      return contactCardResult(updated, "contact_info");
    },
  },
  {
    domain: "contact",
    declaration: {
      name: "search_contact_notes",
      description: "Searches for notes about a specific contact. Use when the question is about ONE client in particular. For general knowledge search without a specific contact, use search_knowledge.",
      schema: z.object({
        query: z.string({ required_error: "The text or question to search in notes is required" })
          .describe("Question or topic to search for in notes"),
        contact_id: z.string().optional().describe("UUID of the contact (optional, for filtering)"),
      }),
    },
    async execute({ query, contact_id }, ctx) {
      return await ctx.ragService.searchNotes(ctx.agentId, query as string, {
        contactId: contact_id as string | undefined,
        threshold: entityThreshold(contact_id as string | undefined),
      });
    },
  },
  {
    domain: "contact",
    declaration: {
      name: "delete_contact",
      description: "Deletes (logical delete) a contact of the advisor. ALWAYS search for the contact first with search_contact to confirm their ID before calling this skill. Must ask for confirmation from the advisor before executing it if they were not explicit.",
      schema: z.object({
        contact_id: z.string({ required_error: "The UUID of the contact to delete is required" })
          .describe("UUID of the contact to delete"),
      }),
    },
    async execute({ contact_id }, ctx) {
      const result = await ctx.contactService.delete(contact_id as string);
      return result ? { success: true, message: `Contact '${result.fullName}' deleted successfully.` } : { success: false, error: "Could not find contact to delete." };
    },
  },
  {
    domain: "contact",
    declaration: {
      name: "add_note_to_client",
      description: "Adds a dated note to a client's profile by their name. Use when the user asks to add comments, notes, or observations to a client mentioning their proper name (e.g., 'add a note to Karina Torres saying...'). This consolidates contact search and note creation into a single step and saves tokens.",
      schema: z.object({
        client_name: z.string({ required_error: "Name of the client to search for (e.g., 'Karina', 'Juan')" }).describe("Name of the client"),
        note_content: z.string({ required_error: "Content of the note to add" }).describe("Content of the note"),
      }),
    },
    async execute({ client_name, note_content }, ctx) {
      const result = await ctx.contactWorkflow.addNoteByName(
        ctx.agentId,
        ctx.sessionId,
        client_name as string,
        note_content as string,
      );
      if (result.outcome !== "added") return clientNotResolved(client_name as string, result);
      return { success: true, message: `Note added successfully to ${result.contact.fullName}.` };
    },
  },
];

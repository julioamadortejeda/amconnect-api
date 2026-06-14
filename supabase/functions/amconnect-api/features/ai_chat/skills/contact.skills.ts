import { z } from "zod";
import { SkillDefinition } from "./skill.core.ts";
import { ContactResponseDTO } from "../../../modules/contact/contact.dto.ts";
import { appendNote } from "../../../shared/utils.ts";

const slimContact = (c: ContactResponseDTO) => ({
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
      description: "Searches for the advisor's contacts/clients by name, email, or any text.",
      schema: z.object({
        query: z.string({ required_error: "A search query (name, email, etc.) is required" })
          .describe("Name, email, or text to search for"),
      }),
    },
    async execute({ query }, ctx) {
      const results = await ctx.contactService.findSimilarContact(ctx.agentId, query as string);
      return (results ?? []).map(slimContact);
    },
  },
  {
    domain: "contact",
    declaration: {
      name: "get_contact",
      description: "Retrieves the complete data of a contact by their ID.",
      schema: z.object({
        contact_id: z.string({ required_error: "The contact UUID is required" })
          .describe("UUID of the contact"),
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
        isProspect: args.is_prospect as boolean ?? false,
      });
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
      return (contacts ?? []).map(slimContact);
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
      description: "Updates data of an existing contact. Use search_contact first to obtain the contact_id if unknown.",
      schema: z.object({
        contact_id: z.string({ required_error: "The UUID of the contact to update is required. Use search_contact first if unknown." })
          .describe("UUID of the contact to update"),
        full_name: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        birthdate: z.string().optional().describe("Date in YYYY-MM-DD format"),
        rfc: z.string().optional(),
        curp: z.string().optional(),
        address: z.string().optional(),
        occupation: z.string().optional(),
        notes: z.string().optional(),
      }),
    },
    async execute(args, ctx) {
      let finalNotes: string | undefined;
      if (args.notes) {
        const existing = await ctx.contactService.getById(args.contact_id as string);
        finalNotes = appendNote(existing?.notes, args.notes as string);
      }

      return await ctx.contactService.update(args.contact_id as string, {
        fullName: (args.full_name ?? args.name) as string | undefined,
        email: args.email as string | undefined,
        phone: args.phone as string | undefined,
        birthdate: (args.birthdate ?? args.birth_date) as string | undefined,
        rfc: args.rfc as string | undefined,
        curp: args.curp as string | undefined,
        address: args.address as string | undefined,
        occupation: args.occupation as string | undefined,
        notes: finalNotes,
      });
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
      description: "Adds (concatenates) a note to a client's profile directly by their name. Use when the user asks to add comments, notes, or observations to a client mentioning their proper name (e.g., 'add a note to Karina Torres saying...'). This consolidates contact search and update into a single step and saves tokens.",
      schema: z.object({
        client_name: z.string({ required_error: "Name of the client to search for (e.g., 'Karina', 'Juan')" }).describe("Name of the client"),
        note_content: z.string({ required_error: "Content of the note to add" }).describe("Content of the note"),
      }),
    },
    async execute({ client_name, note_content }, ctx) {
      const contacts = await ctx.contactService.findSimilarContact(ctx.agentId, client_name as string);
      if (!contacts || contacts.length === 0) {
        return { error: `No client found matching '${client_name}'.` };
      }
      if (contacts.length > 1) {
        return {
          error: `Multiple clients found matching '${client_name}'. Please be more specific.`,
          matches: contacts.map(c => ({ id: c.id, fullName: c.fullName }))
        };
      }

      const contact = contacts[0];
      const currentNotes = contact.notes;
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const todayStr = `${day}/${month}/${year}`;
      const newNoteEntry = `[${todayStr}]: ${note_content}`;
      const finalNotes = currentNotes ? `${currentNotes}\n${newNoteEntry}` : newNoteEntry;

      const updated = await ctx.contactService.update(contact.id, { notes: finalNotes });
      return updated ? { success: true, message: `Note added successfully to ${updated.fullName}.` } : { success: false, error: "Could not update contact." };
    },
  },
];

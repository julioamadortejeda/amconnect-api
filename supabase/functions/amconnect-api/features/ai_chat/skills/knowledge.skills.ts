import { z } from "zod";
import { SkillDefinition } from "./skill.core.ts";

export const knowledgeSkills: SkillDefinition[] = [
  {
    domain: "knowledge",
    declaration: {
      name: "search_knowledge",
      description: "Searches the entire advisor knowledge base: meeting notes, audios, documents, WhatsApp conversations, client info, and policies. Use when the user asks for information that might have been entered previously and is not in structured data.",
      schema: z.object({
        query: z.string({ required_error: "The text or question to search for is required" })
          .describe("Question or topic to search for in the knowledge base"),
      }),
    },
    async execute({ query }, ctx) {
      return await ctx.ragService.searchNotes(ctx.agentId, query as string, { threshold: 0.5 });
    },
  },
];

import { z } from "zod";
import { SkillDefinition } from "./skill.core.ts";

export const knowledgeSkills: SkillDefinition[] = [
  {
    domain: "knowledge",
    declaration: {
      name: "search_knowledge",
      description: "Busca en toda la base de conocimiento del asesor: notas de reuniones, audios, documentos, conversaciones de WhatsApp, información de clientes y pólizas. Usar cuando el usuario pregunte por información que pudo haber sido ingresada previamente y no está en los datos estructurados.",
      schema: z.object({
        query: z.string({ required_error: "Se requiere el texto o pregunta a buscar" })
          .describe("Pregunta o tema a buscar en la base de conocimiento"),
      }),
    },
    async execute({ query }, ctx) {
      return await ctx.ragService.searchNotes(ctx.agentId, query as string, { threshold: 0.5 });
    },
  },
];

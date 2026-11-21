import { z } from "zod";
import { SkillDefinition } from "./skill.core.ts";
import { recallResult } from "./recall.mapper.ts";
import { RECALL_GROUPS, type RecallGroup } from "../../recall/recall.types.ts";

export const recallSkills: SkillDefinition[] = [
  {
    domain: "knowledge",
    declaration: {
      name: "recall",
      description:
        "Open-ended sweep across EVERYTHING the advisor has stored, in one call: contacts, policies, reminders, commitments, notes and documents, returned in six separate groups. " +
        "Use it ONLY for open questions where you do not know where the answer lives: 'what do I have on Julio', 'where did I see the hernia thing', 'everything about Allianz'. " +
        "If the question names a concrete item ('summary of Julio's GMM policy', 'what does María's reminder say', 'who do I owe a call'), use the direct skill for that item instead (get_policy, search_reminders, get_commitments, ...). " +
        "Each group has `moreAvailable`; each document has `moreInDocument`. To see more, call again with `page: 2` and the same query and the returned `searchId` (it reuses the stored search so pages do not repeat). " +
        "`omittedForSize` means results were trimmed to fit: narrow with `contact_id` or `groups`.",
      schema: z.object({
        query: z.string({ required_error: "The text to search for is required" }).min(1)
          .describe("What to look for: a topic, a name, a term ('hernia'), an insurer, a policy number."),
        contact_id: z.string().optional().describe(
          "UUID of a contact: restricts the sweep to that client (the contacts group is then skipped).",
        ),
        page: z.number().int().min(1).optional().describe("Page of results, starting at 1. Default 1."),
        groups: z.array(z.enum(RECALL_GROUPS)).optional().describe(
          "Only these groups. Default: all six.",
        ),
        search_id: z.string().optional().describe(
          "The `searchId` returned by a previous recall with the SAME query, to get page 2+ with the same ordering.",
        ),
      }),
    },
    async execute(args, ctx) {
      const p = args as Record<string, unknown>;
      const result = await ctx.recallService.recall(ctx.agentId, {
        query: p.query as string,
        contactId: p.contact_id as string | undefined,
        page: p.page as number | undefined,
        groups: p.groups as RecallGroup[] | undefined,
        searchId: p.search_id as string | undefined,
      });
      return recallResult(result, ctx.timezone);
    },
  },
];

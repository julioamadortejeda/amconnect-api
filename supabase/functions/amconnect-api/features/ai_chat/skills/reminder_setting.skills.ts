import { z } from "zod";
import { SkillDefinition } from "./skill.core.ts";

export const reminderSettingSkills: SkillDefinition[] = [
  {
    domain: "reminder",
    declaration: {
      name: "get_reminder_settings",
      description:
        "Returns how far in advance the advisor is warned for each reminder type (payments, renewals, policy anniversaries, client birthdays), including per-branch exceptions. Call this before update_reminder_setting to discover the available type codes and the values currently in force. Also use it to answer questions like 'how early do you warn me about payments?'.",
      schema: z.object({}),
    },
    async execute(_args, ctx) {
      return await ctx.reminderSettingService.getEffective();
    },
  },
  {
    domain: "reminder",
    declaration: {
      name: "update_reminder_setting",
      description:
        "Changes how many days in advance the advisor is warned for a reminder type, or turns that type off entirely. " +
        "Omit branch_id to change the advisor's default for every branch; pass branch_id (from search_branch) to set an exception for one branch only, e.g. 'warn me 30 days ahead for Gastos Médicos payments'. " +
        "The reminder type is NOT optional and must never be guessed: if the advisor did not make clear whether they mean payments, renewals, anniversaries or birthdays, ask them first. " +
        "After changing it, tell the advisor the new value and mention that the other branches keep their previous setting.",
      schema: z.object({
        reminder_type_code: z.string().optional()
          .describe("Type code from get_reminder_settings: PAYMENT, RENEWAL, ANNIVERSARY or BIRTHDAY. Call that skill first if you do not have it, and ask the advisor which one they mean when it is not clear."),
        reminder_type_id: z.string().optional().describe("Accepted alias: UUID of the reminder type"),
        branch_id: z.string().optional()
          .describe("UUID of the branch (from search_branch) to set an exception for. Omit for the advisor's default."),
        days_before: z.number().optional()
          .describe("Days of advance warning. 0 means warn on the day itself."),
        is_active: z.boolean().optional()
          .describe("false silences this reminder type ('do not remind me about birthdays')"),
      }),
    },
    async execute(args, ctx) {
      const typeCode = (args.reminder_type_code ?? args.type_code) as string | undefined;
      const typeId = (args.reminder_type_id ?? args.type_id) as string | undefined;
      if (!typeCode && !typeId) {
        return {
          error:
            "The reminder type is required.",
        };
      }

      const daysBefore = args.days_before as number | undefined;
      const isActive = args.is_active as boolean | undefined;
      if (daysBefore === undefined && isActive === undefined) {
        return { error: "Specify days_before, is_active, or both." };
      }

      return await ctx.reminderSettingService.update({
        reminderTypeCode: typeCode,
        reminderTypeId: typeId,
        branchId: (args.branch_id as string | undefined) ?? null,
        daysBefore,
        isActive,
      });
    },
  },
];

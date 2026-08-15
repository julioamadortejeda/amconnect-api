import { z } from "zod";

export const ReminderSettingRequestSchema = z.object({
  // The type can arrive as an id or as a catalog code ("PAYMENT"), so the AI
  // skill does not have to resolve the catalog first.
  reminderTypeId: z.string().uuid().optional(),
  reminderTypeCode: z.string().min(1).optional(),
  /** null (or absent) targets the advisor's default for the type. */
  branchId: z.string().uuid().optional().nullable(),
  daysBefore: z.number().int().min(0).max(365).optional(),
  isActive: z.boolean().optional(),
}).refine(
  (v) => Boolean(v.reminderTypeId ?? v.reminderTypeCode),
  { message: "reminderTypeId o reminderTypeCode es obligatorio" },
).refine(
  (v) => v.daysBefore !== undefined || v.isActive !== undefined,
  { message: "Indica daysBefore o isActive" },
);

export type ReminderSettingRequestDTO = z.infer<typeof ReminderSettingRequestSchema>;

/** A per-branch exception to the advisor's default for a reminder type. */
export interface ReminderSettingOverrideDTO {
  id: string;
  branchId: string;
  branchName: string;
  daysBefore: number;
  isActive: boolean;
}

/**
 * The effective configuration of one reminder type, already resolved server-side:
 * `daysBefore`/`isActive` are what the job will actually use, whether they come
 * from a stored row or from the built-in default.
 */
export interface ReminderSettingDTO {
  typeId: string;
  typeCode: string;
  typeName: string;
  daysBefore: number;
  isActive: boolean;
  /** false when the values above come from the built-in default. */
  isCustomized: boolean;
  /** Row id of the stored default, when there is one. */
  settingId: string | null;
  overrides: ReminderSettingOverrideDTO[];
}

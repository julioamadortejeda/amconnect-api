import { SupabaseClient } from "@supabase/supabase-js";
import { handleSupabaseError } from "../../shared/errors.ts";
import type { ReminderTypeRow } from "./reminder_generation.repository.ts";

export interface ReminderSettingRow {
  id: string;
  reminderTypeId: string;
  /** null = the advisor's default for the type; a value = per-branch exception. */
  branchId: string | null;
  daysBefore: number;
  isActive: boolean;
}

export interface BranchRow {
  id: string;
  name: string;
}

export interface UpsertReminderSettingData {
  agentId: string;
  reminderTypeId: string;
  branchId: string | null;
  daysBefore?: number;
  isActive?: boolean;
}

export interface IReminderSettingRepository {
  findAllByAgent(agentId: string): Promise<ReminderSettingRow[]>;
  findTypesByCodes(codes: readonly string[]): Promise<ReminderTypeRow[]>;
  findBranches(agentId: string): Promise<BranchRow[]>;
  upsert(data: UpsertReminderSettingData): Promise<ReminderSettingRow>;
  deleteOverride(agentId: string, reminderTypeId: string, branchId: string): Promise<void>;
}

function toRow(row: Record<string, unknown>): ReminderSettingRow {
  return {
    id: row.id as string,
    reminderTypeId: row.reminder_type_id as string,
    branchId: (row.branch_id as string | null) ?? null,
    daysBefore: row.days_before as number,
    isActive: row.is_active as boolean,
  };
}

export class ReminderSettingRepository implements IReminderSettingRepository {
  constructor(private supabase: SupabaseClient) {}

  async findAllByAgent(agentId: string): Promise<ReminderSettingRow[]> {
    const { data, error } = await this.supabase
      .from("reminder_settings")
      .select("id, reminder_type_id, branch_id, days_before, is_active")
      .eq("agent_id", agentId);

    if (error) handleSupabaseError(error, "reminder_settings.findAllByAgent");
    return (data ?? []).map(toRow);
  }

  async findTypesByCodes(codes: readonly string[]): Promise<ReminderTypeRow[]> {
    const { data, error } = await this.supabase
      .from("reminder_types")
      .select("id, code, name")
      .in("code", codes as string[])
      .eq("is_active", true);

    if (error) handleSupabaseError(error, "reminder_settings.findTypesByCodes");
    return (data ?? []) as ReminderTypeRow[];
  }

  async findBranches(agentId: string): Promise<BranchRow[]> {
    const { data, error } = await this.supabase
      .from("branches")
      .select("id, name")
      .eq("agent_id", agentId)
      .eq("is_active", true)
      .order("name");

    if (error) handleSupabaseError(error, "reminder_settings.findBranches");
    return (data ?? []) as BranchRow[];
  }

  /**
   * Stores the advisor's choice for (type, branch). The unique indexes are
   * partial — Postgres cannot upsert against them — so the existing row is
   * looked up first.
   */
  async upsert(data: UpsertReminderSettingData): Promise<ReminderSettingRow> {
    let lookup = this.supabase
      .from("reminder_settings")
      .select("id, reminder_type_id, branch_id, days_before, is_active")
      .eq("agent_id", data.agentId)
      .eq("reminder_type_id", data.reminderTypeId);

    lookup = data.branchId === null
      ? lookup.is("branch_id", null)
      : lookup.eq("branch_id", data.branchId);

    const { data: found, error: lookupError } = await lookup.maybeSingle();
    if (lookupError) handleSupabaseError(lookupError, "reminder_settings.upsert.lookup");

    const values: Record<string, unknown> = {};
    if (data.daysBefore !== undefined) values.days_before = data.daysBefore;
    if (data.isActive !== undefined) values.is_active = data.isActive;

    if (found) {
      const { data: updated, error } = await this.supabase
        .from("reminder_settings")
        .update(values)
        .eq("id", (found as { id: string }).id)
        .select("id, reminder_type_id, branch_id, days_before, is_active")
        .single();

      if (error) handleSupabaseError(error, "reminder_settings.upsert.update");
      return toRow(updated as Record<string, unknown>);
    }

    const { data: inserted, error } = await this.supabase
      .from("reminder_settings")
      .insert({
        agent_id: data.agentId,
        reminder_type_id: data.reminderTypeId,
        branch_id: data.branchId,
        ...values,
      })
      .select("id, reminder_type_id, branch_id, days_before, is_active")
      .single();

    if (error) handleSupabaseError(error, "reminder_settings.upsert.insert");
    return toRow(inserted as Record<string, unknown>);
  }

  /**
   * Borra la excepción de un ramo para que vuelva a regir el default.
   *
   * Es un DELETE real y no el soft delete de la regla general: esto no es un
   * registro de negocio del asesor sino configuración, y la AUSENCIA de fila es
   * justamente el estado que significa "sin excepción". Una fila marcada como
   * borrada seguiría ocupando el índice único y bloquearía volver a crearla.
   */
  async deleteOverride(agentId: string, reminderTypeId: string, branchId: string): Promise<void> {
    const { error } = await this.supabase
      .from("reminder_settings")
      .delete()
      .eq("agent_id", agentId)
      .eq("reminder_type_id", reminderTypeId)
      .eq("branch_id", branchId);

    if (error) handleSupabaseError(error, "reminder_settings.deleteOverride");
  }
}

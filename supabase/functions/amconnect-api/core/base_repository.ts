import { SupabaseClient } from "@supabase/supabase-js";
import { IRepository } from "./repository.interface.ts";
import { handleSupabaseError } from "../shared/errors.ts";

export class SupabaseRepository<T> implements IRepository<T> {
  protected supabase: SupabaseClient;
  protected tableName: string;
  protected selectString: string;
  protected filterActive: boolean;

  constructor(supabase: SupabaseClient, tableName: string, selectString = "*", filterActive = true) {
    this.supabase = supabase;
    this.tableName = tableName;
    this.selectString = selectString;
    this.filterActive = filterActive;
  }

  // deno-lint-ignore no-explicit-any
  protected get table(): any {
    return this.supabase.from(this.tableName);
  }

  private applyActiveFilter(query: unknown): unknown {
    // deno-lint-ignore no-explicit-any
    return this.filterActive ? (query as any).eq("is_active", true) : query;
  }

  async getAll(limit = 100): Promise<T[] | null> {
    const { data, error } = await (this.applyActiveFilter(
      this.table.select(this.selectString)
    ) as any)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) handleSupabaseError(error, `Error al cargar datos de ${this.tableName}.`);
    return data as T[];
  }

  async getById(id: string): Promise<T | null> {
    const { data, error } = await (this.applyActiveFilter(
      this.table.select(this.selectString)
    ) as any)
      .eq("id", id)
      .single();

    if (error) handleSupabaseError(error, `Registro no encontrado en ${this.tableName}.`);
    return data as T;
  }

  async getByField(field: string, value: unknown, limit = 100): Promise<T[] | null> {
    const { data, error } = await (this.applyActiveFilter(
      this.table.select(this.selectString)
    ) as any)
      .eq(field, value)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) handleSupabaseError(error, `Error al cargar datos de ${this.tableName}.`);
    return data as T[];
  }

  async findByFilters(
    filters: Partial<Record<string, unknown>>,
    limit = 100,
  ): Promise<T[] | null> {
    let query = this.applyActiveFilter(this.table.select(this.selectString));

    for (const [field, value] of Object.entries(filters)) {
      if (value === null) {
        // deno-lint-ignore no-explicit-any
        query = (query as any).is(field, null);
      } else if (value !== undefined) {
        // deno-lint-ignore no-explicit-any
        query = (query as any).eq(field, value);
      }
    }

    // deno-lint-ignore no-explicit-any
    const { data, error } = await (query as any)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) handleSupabaseError(error, `Error al cargar datos de ${this.tableName}.`);
    return data as T[];
  }

  async findByOr(
    orConditions: string,
    filters?: Partial<Record<string, unknown>>,
    limit?: number,
  ): Promise<T[] | null> {
    let query = this.applyActiveFilter(this.table.select(this.selectString));

    if (filters && Object.keys(filters).length > 0) {
      // deno-lint-ignore no-explicit-any
      query = (query as any).match(filters);
    }
    // deno-lint-ignore no-explicit-any
    query = (query as any).or(orConditions);
    // deno-lint-ignore no-explicit-any
    if (limit) query = (query as any).limit(limit);

    // deno-lint-ignore no-explicit-any
    const { data, error } = await (query as any);
    if (error) {
      console.error(`[SupabaseRepository.findByOr] ${this.tableName}:`, error);
      return null;
    }
    return data as T[];
  }

  async create(data: Partial<T>): Promise<T | null> {
    // deno-lint-ignore no-explicit-any
    const { data: result, error } = await this.table.insert([data as any]).select().single();
    if (error) handleSupabaseError(error, `Error al guardar en ${this.tableName}.`);
    return result as T;
  }

  async update(id: string, data: Partial<T>): Promise<T | null> {
    let query = this.table.update(data as never).eq("id", id);
    if (this.filterActive) query = query.eq("is_active", true);
    const { data: result, error } = await query.select(this.selectString).single();
    if (error) handleSupabaseError(error, `Error al actualizar en ${this.tableName}.`);
    return result as T;
  }

  async upsert(data: Partial<T>): Promise<T | null> {
    // deno-lint-ignore no-explicit-any
    const { data: result, error } = await this.table.upsert(data as any).select().single();
    if (error) handleSupabaseError(error, `Error al hacer upsert en ${this.tableName}.`);
    return result as T;
  }

  async delete(id: string): Promise<T | null> {
    const { data: result, error } = await this.table
      // deno-lint-ignore no-explicit-any
      .update({ is_active: false, deleted_at: new Date().toISOString() } as any)
      .eq("id", id)
      .select(this.selectString)
      .single();

    if (error) handleSupabaseError(error, `Error al eliminar en ${this.tableName}.`);
    return result as T;
  }

  async search(query: string, threshold = 0.3): Promise<T[] | null> {
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (this.supabase.rpc as any)("search_catalog", {
      p_table_name: this.tableName,
      p_query: query,
      p_threshold: threshold,
    });

    if (error) {
      console.error(`[SupabaseRepository.search] ${this.tableName}:`, error);
      return null;
    }
    return data as T[];
  }

  async count(filters: Partial<Record<string, unknown>> = {}): Promise<number> {
    let query = this.applyActiveFilter(
      this.table.select("*", { count: "exact", head: true })
    );
    for (const [field, value] of Object.entries(filters)) {
      // deno-lint-ignore no-explicit-any
      if (value !== undefined) query = (query as any).eq(field, value);
    }
    // deno-lint-ignore no-explicit-any
    const { count, error } = await (query as any);
    if (error) handleSupabaseError(error, `Error al contar en ${this.tableName}.`);
    return count ?? 0;
  }

  withExpand(selectString: string): SupabaseRepository<T> {
    return new SupabaseRepository<T>(this.supabase, this.tableName, selectString, this.filterActive);
  }
}

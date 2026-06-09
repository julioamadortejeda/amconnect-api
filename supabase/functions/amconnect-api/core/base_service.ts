import { IRepository, PaginatedResult } from "./repository.interface.ts";
import { IService } from "./service.interface.ts";

export abstract class BaseService<TRequest, TResponse = TRequest>
  implements IService<TRequest, TResponse> {
  protected repository: IRepository<TResponse>;

  constructor(repository: IRepository<TResponse>) {
    this.repository = repository;
  }

  protected toDTO(row: unknown): TResponse {
    return row as TResponse;
  }

  async getAll(limit = 100): Promise<TResponse[] | null> {
    const rows = await this.repository.getAll(limit);
    return rows ? rows.map((r) => this.toDTO(r)) : null;
  }

  async getByField(field: string, value: unknown, limit = 100): Promise<TResponse[] | null> {
    const rows = await this.repository.getByField(field, value, limit);
    return rows ? rows.map((r) => this.toDTO(r)) : null;
  }

  async getById(id: string): Promise<TResponse | null> {
    const row = await this.repository.getById(id);
    return row ? this.toDTO(row) : null;
  }

  async findByFilters(filters: Partial<Record<string, unknown>>, limit = 100): Promise<TResponse[] | null> {
    const rows = await this.repository.findByFilters(filters, limit);
    return rows ? rows.map((r) => this.toDTO(r)) : null;
  }

  async paginate(
    filters: Partial<Record<string, unknown>> = {},
    page = 1,
    pageSize = 20,
  ): Promise<PaginatedResult<TResponse>> {
    const result = await this.repository.paginate(filters, page, pageSize);
    return {
      ...result,
      data: result.data ? result.data.map((r) => this.toDTO(r)) : [],
    };
  }

  async count(filters: Partial<Record<string, unknown>> = {}): Promise<number> {
    return await this.repository.count(filters);
  }

  async search(query: string, threshold = 0.3): Promise<TResponse[] | null> {
    const rows = await this.repository.search(query, threshold);
    return rows ? rows.map((r) => this.toDTO(r)) : null;
  }

  protected prepareForCreate(data: Partial<TRequest>): Record<string, unknown> {
    return data as Record<string, unknown>;
  }

  protected prepareForUpdate(_id: string, data: Partial<TRequest>): Record<string, unknown> {
    return data as Record<string, unknown>;
  }

  async create(data: Partial<TRequest>): Promise<TResponse | null> {
    const prepared = this.prepareForCreate(data);
    // deno-lint-ignore no-explicit-any
    const row = await this.repository.create(prepared as any);
    return row ? this.toDTO(row) : null;
  }

  async update(id: string, data: Partial<TRequest>): Promise<TResponse | null> {
    const prepared = this.prepareForUpdate(id, data);
    // deno-lint-ignore no-explicit-any
    const row = await this.repository.update(id, prepared as any);
    return row ? this.toDTO(row) : null;
  }

  async upsert(data: Partial<TRequest>): Promise<TResponse | null> {
    const prepared = this.prepareForCreate(data);
    // deno-lint-ignore no-explicit-any
    const row = await this.repository.upsert(prepared as any);
    return row ? this.toDTO(row) : null;
  }

  async delete(id: string): Promise<TResponse | null> {
    const row = await this.repository.delete(id);
    return row ? this.toDTO(row) : null;
  }
}

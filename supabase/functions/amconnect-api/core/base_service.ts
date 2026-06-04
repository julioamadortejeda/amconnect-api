import { IRepository } from "./repository.interface.ts";
import { IService } from "./service.interface.ts";

export abstract class BaseService<TRequest, TResponse = TRequest>
  implements IService<TRequest, TResponse> {
  protected repository: IRepository<TResponse>;

  constructor(repository: IRepository<TResponse>) {
    this.repository = repository;
  }

  async getAll(limit = 100): Promise<TResponse[] | null> {
    return await this.repository.getAll(limit);
  }

  async getByField(field: string, value: unknown, limit = 100): Promise<TResponse[] | null> {
    return await this.repository.getByField(field, value, limit);
  }

  async getById(id: string): Promise<TResponse | null> {
    return await this.repository.getById(id);
  }

  async count(filters: Partial<Record<string, unknown>> = {}): Promise<number> {
    return await this.repository.count(filters);
  }

  async search(query: string, threshold = 0.3): Promise<TResponse[] | null> {
    return await this.repository.search(query, threshold);
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
    return await this.repository.create(prepared as any);
  }

  async update(id: string, data: Partial<TRequest>): Promise<TResponse | null> {
    const prepared = this.prepareForUpdate(id, data);
    // deno-lint-ignore no-explicit-any
    return await this.repository.update(id, prepared as any);
  }

  async upsert(data: Partial<TRequest>): Promise<TResponse | null> {
    const prepared = this.prepareForCreate(data);
    // deno-lint-ignore no-explicit-any
    return await this.repository.upsert(prepared as any);
  }

  async delete(id: string): Promise<TResponse | null> {
    return await this.repository.delete(id);
  }
}

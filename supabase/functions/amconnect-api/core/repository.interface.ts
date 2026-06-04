export interface IRepository<T> {
  getAll(limit?: number): Promise<T[] | null>;
  getById(id: string): Promise<T | null>;
  getByField(field: string, value: unknown, limit?: number): Promise<T[] | null>;
  findByFilters(filters: Partial<Record<string, unknown>>, limit?: number): Promise<T[] | null>;
  findByOr(orConditions: string, filters?: Partial<Record<string, unknown>>, limit?: number): Promise<T[] | null>;
  create(data: Partial<T>): Promise<T | null>;
  update(id: string, data: Partial<T>): Promise<T | null>;
  upsert(data: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<T | null>;
  count(filters?: Partial<Record<string, unknown>>): Promise<number>;
  search(query: string, threshold?: number): Promise<T[] | null>;
  withExpand(selectString: string): IRepository<T>;
}

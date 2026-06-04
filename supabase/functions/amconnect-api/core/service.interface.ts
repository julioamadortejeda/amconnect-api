export interface IService<TRequest, TResponse = TRequest> {
  getAll(limit?: number): Promise<TResponse[] | null>;
  getByField(field: string, value: unknown, limit?: number): Promise<TResponse[] | null>;
  getById(id: string): Promise<TResponse | null>;
  create(data: Partial<TRequest>): Promise<TResponse | null>;
  update(id: string, data: Partial<TRequest>): Promise<TResponse | null>;
  upsert(data: Partial<TRequest>): Promise<TResponse | null>;
  delete(id: string): Promise<TResponse | null>;
  search(query: string, threshold?: number): Promise<TResponse[] | null>;
  getDefault?(): Promise<TResponse | null>;
}

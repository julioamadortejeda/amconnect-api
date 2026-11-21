// Cliente de Supabase falso para pruebas de repositorios y middleware.
//
// Úsalo solo cuando el código bajo prueba recibe un `SupabaseClient` y no hay
// una interfaz de repositorio que falsear (p. ej. el middleware del DI, que
// construye sus repos a partir del cliente). Para services, falsea el repo.
//
// Cada `from(tabla)` devuelve un builder que acepta CUALQUIER cadena de métodos
// (`select().eq().in().maybeSingle()`...), los anota y, al hacer `await`,
// responde lo que diga el handler de esa tabla. Así la prueba no depende de
// cuántos filtros encadene el repo, pero puede verificarlos si le importa.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface FakeError {
  code: string;
  message: string;
  details?: string;
  hint?: string;
}

export interface QueryResult {
  data: unknown;
  error: FakeError | null;
  count?: number | null;
}

export interface RecordedOp {
  method: string;
  args: unknown[];
}

export class RecordedQuery {
  readonly ops: RecordedOp[] = [];
  constructor(readonly table: string) {}

  /** Argumentos de la primera llamada a `method` (o undefined si no hubo). */
  args(method: string): unknown[] | undefined {
    return this.ops.find((o) => o.method === method)?.args;
  }

  has(method: string): boolean {
    return this.ops.some((o) => o.method === method);
  }

  /** Valor de un filtro `.eq(column, value)`. */
  eq(column: string): unknown {
    return this.ops.find((o) => o.method === "eq" && o.args[0] === column)?.args[1];
  }
}

export type TableHandler = QueryResult | ((q: RecordedQuery) => QueryResult);
export type RpcHandler = QueryResult | ((args: Record<string, unknown>) => QueryResult);

const OK_EMPTY: QueryResult = { data: null, error: null };

export class FakeSupabase {
  readonly queries: RecordedQuery[] = [];
  readonly rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];

  constructor(
    private tables: Record<string, TableHandler> = {},
    private rpcs: Record<string, RpcHandler> = {},
  ) {}

  /** El fake con el tipo que esperan repos y middleware. */
  get client(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }

  queriesTo(table: string): RecordedQuery[] {
    return this.queries.filter((q) => q.table === table);
  }

  from(table: string): unknown {
    const query = new RecordedQuery(table);
    this.queries.push(query);
    const handler = this.tables[table];
    const resolve = () => (typeof handler === "function" ? handler(query) : handler ?? OK_EMPTY);
    return chain(query, resolve);
  }

  rpc(fn: string, args: Record<string, unknown> = {}): unknown {
    this.rpcCalls.push({ fn, args });
    const handler = this.rpcs[fn];
    const result = typeof handler === "function" ? handler(args) : handler ?? OK_EMPTY;
    const query = new RecordedQuery(`rpc:${fn}`);
    return chain(query, () => result);
  }
}

// Proxy encadenable: todo método devuelve el mismo builder; `then` lo resuelve.
function chain(query: RecordedQuery, resolve: () => QueryResult): unknown {
  const proxy: unknown = new Proxy({}, {
    get(_target, prop) {
      if (prop === "then") {
        return (onOk: (v: QueryResult) => unknown, onErr?: (e: unknown) => unknown) =>
          Promise.resolve().then(resolve).then(onOk, onErr);
      }
      return (...args: unknown[]) => {
        query.ops.push({ method: String(prop), args });
        return proxy;
      };
    },
  });
  return proxy;
}

export function pgError(code: string, message = `fake ${code}`): FakeError {
  return { code, message, details: "", hint: "" };
}

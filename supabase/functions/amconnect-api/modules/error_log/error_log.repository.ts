import { SupabaseClient } from "@supabase/supabase-js";

export interface ErrorLogInput {
  agentId?: string | null;
  errorType: string;
  statusCode: number;
  errorMessage: string;
  stackTrace?: string | null;
  requestPath?: string | null;
  requestMethod?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface IErrorLogRepository {
  insert(input: ErrorLogInput): Promise<string | null>;
}

export class ErrorLogRepository implements IErrorLogRepository {
  constructor(private supabase: SupabaseClient) {}

  async insert(input: ErrorLogInput): Promise<string | null> {
    // El id se genera en código: la policy RLS de error_logs solo permite INSERT
    // (sin SELECT), y un insert().select() requiere policy de SELECT para el
    // RETURNING — fallaría completo y no se guardaría nada.
    const id = crypto.randomUUID();
    try {
      const { error } = await this.supabase
        .from("error_logs")
        .insert({
          id,
          agent_id: input.agentId ?? null,
          error_type: input.errorType,
          status_code: input.statusCode,
          error_message: input.errorMessage,
          stack_trace: input.stackTrace ?? null,
          request_path: input.requestPath ?? null,
          request_method: input.requestMethod ?? null,
          metadata: input.metadata ?? null,
        });
      if (error) {
        console.error("[ErrorLog] insert failed:", error.code, error.message);
        return null;
      }
      return id;
    } catch (e) {
      console.error("[ErrorLog] insert threw:", e);
      return null;
    }
  }
}

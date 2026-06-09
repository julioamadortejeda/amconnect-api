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
    try {
      const { data } = await this.supabase
        .from("error_logs")
        .insert({
          agent_id: input.agentId ?? null,
          error_type: input.errorType,
          status_code: input.statusCode,
          error_message: input.errorMessage,
          stack_trace: input.stackTrace ?? null,
          request_path: input.requestPath ?? null,
          request_method: input.requestMethod ?? null,
          metadata: input.metadata ?? null,
        })
        .select("id")
        .single();
      return data?.id ?? null;
    } catch {
      return null;
    }
  }
}

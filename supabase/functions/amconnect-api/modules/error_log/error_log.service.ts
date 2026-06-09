import type { IErrorLogRepository, ErrorLogInput } from "./error_log.repository.ts";

export type { ErrorLogInput } from "./error_log.repository.ts";

export class ErrorLogService {
  constructor(private repository: IErrorLogRepository) {}

  async log(input: ErrorLogInput): Promise<string | null> {
    return await this.repository.insert(input);
  }
}

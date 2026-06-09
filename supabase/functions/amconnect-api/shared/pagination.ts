import { Context } from "hono";

export function parsePagination(
  c: Context,
  defaultPageSize = 20,
  maxPageSize = 100,
): { page: number; pageSize: number } {
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1") || 1);
  const pageSize = Math.min(
    Math.max(1, parseInt(c.req.query("pageSize") ?? String(defaultPageSize)) || defaultPageSize),
    maxPageSize,
  );
  return { page, pageSize };
}

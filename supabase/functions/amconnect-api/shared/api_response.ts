import { Context } from "hono";

export function sendSuccess<T>(c: Context, data: T, status = 200) {
  return c.json({ success: true, data }, status as 200);
}

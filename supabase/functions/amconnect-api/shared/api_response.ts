import { Context } from "hono";

export function sendSuccess<T>(c: Context, data: T, status = 200) {
  return c.json({ success: true, data }, status as 200);
}

export function sendError(c: Context, message: string, status = 500) {
  return c.json({ success: false, error: message }, status as 500);
}

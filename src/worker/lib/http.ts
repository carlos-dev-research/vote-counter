import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Reads a JSON object body. Returns null unless Content-Type is application/json and the
 * body is a JSON object. Requiring JSON blocks cross-site HTML form posts (part of CSRF defense).
 */
export async function readJson(c: Context): Promise<Record<string, unknown> | null> {
  const type = c.req.header("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) return null;
  try {
    const body: unknown = await c.req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Standard error response: `{ error }` with the given status. */
export function fail(c: Context, status: ContentfulStatusCode, error: string): Response {
  return c.json({ error }, status);
}

/** True when the request came over HTTPS (cookies get the Secure flag; plain http://localhost does not). */
export function isHttps(c: Context): boolean {
  return new URL(c.req.url).protocol === "https:";
}

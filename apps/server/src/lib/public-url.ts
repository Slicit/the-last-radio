import type { Context } from "hono";
import { env } from "./env.js";

/**
 * The origin people and AI clients reach us at, e.g. https://radio.example.com.
 * PUBLIC_URL wins; otherwise it's derived from the request (nginx forwards
 * Host with its port and X-Forwarded-Proto).
 */
export function publicUrl(c: Context): string {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/+$/, "");
  const proto = c.req.header("x-forwarded-proto") ?? new URL(c.req.url).protocol.replace(":", "");
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? new URL(c.req.url).host;
  return `${proto}://${host}`;
}

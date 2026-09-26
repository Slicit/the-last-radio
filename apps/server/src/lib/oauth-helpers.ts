// Pure OAuth checks, kept apart from the routes so they're easy to test.
import { createHash } from "node:crypto";
import { isScope, SCOPES, type Scope } from "./scopes.js";

const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https anywhere; plain http only back to the user's own machine (RFC 8252). */
export function acceptableRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    return u.protocol === "https:" || (u.protocol === "http:" && LOOPBACK.has(u.hostname));
  } catch {
    return false;
  }
}

/** Exact match, except loopback redirects may use any port (native apps pick one at runtime). */
export function redirectMatches(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) return true;
  try {
    const u = new URL(uri);
    if (!LOOPBACK.has(u.hostname)) return false;
    return registered.some((r) => {
      const v = new URL(r);
      return LOOPBACK.has(v.hostname) && v.protocol === u.protocol && v.pathname === u.pathname && v.search === u.search;
    });
  } catch {
    return false;
  }
}

export function parseScopes(scope: string | undefined): Scope[] | null {
  if (!scope?.trim()) return ALL_SCOPES;
  const asked = scope.trim().split(/\s+/);
  return asked.every(isScope) ? [...new Set(asked)] : null;
}

export const pkceS256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");


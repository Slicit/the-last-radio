import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// yt-dlp fetches whatever link people submit from inside our network, so a
// link must not point at our own services (postgres, mediamtx's API, …) or
// anything else private: no loopback, private, link-local or internal names.

function privateV4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast, reserved
  );
}

function privateV6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("::ffff:")) return privateV4(v.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
}

export const isPrivateAddress = (ip: string) => (isIP(ip) === 6 ? privateV6(ip) : privateV4(ip));

export class UnsafeUrlError extends Error {}

/** Throws unless `raw` is an http(s) URL on a public host. */
export async function assertPublicUrl(raw: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError("That doesn't look like a link");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsafeUrlError("Only http(s) links");
  if (u.username || u.password) throw new UnsafeUrlError("Links with credentials aren't allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  // Single-label names (api, postgres, localhost) only resolve inside our network.
  if (!isIP(host) && (!host.includes(".") || /\.(local|internal|home|lan|localhost)$/i.test(host))) {
    throw new UnsafeUrlError("That link points to a private address");
  }
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new UnsafeUrlError("That site can't be reached");
  if (addrs.some(isPrivateAddress)) throw new UnsafeUrlError("That link points to a private address");
}

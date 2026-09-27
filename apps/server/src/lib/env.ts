function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function cacheBytes(): number {
  const bytes = process.env.CACHE_MAX_BYTES ? Number(process.env.CACHE_MAX_BYTES) : Number(process.env.CACHE_SIZE_GB || 2) * 1024 ** 3;
  if (!Number.isFinite(bytes) || bytes < 100 * 1024 ** 2) throw new Error("CACHE_SIZE_GB must be a number of GB (at least 0.1)");
  return Math.floor(bytes);
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  PORT: Number(process.env.PORT ?? 3000),
  MEDIAMTX_API: process.env.MEDIAMTX_API ?? "http://localhost:9997",
  MEDIAMTX_RTSP: process.env.MEDIAMTX_RTSP ?? "rtsp://localhost:8554",
  COOKIE_SECURE: process.env.COOKIE_SECURE === "true",
  CACHE_DIR: process.env.CACHE_DIR ?? "/tmp/lastradio-cache",
  // Audio cache size: CACHE_SIZE_GB (default 2), or CACHE_MAX_BYTES for the exact figure.
  CACHE_MAX_BYTES: cacheBytes(),
  // Public origin for OAuth/MCP metadata; derived from the request when unset.
  PUBLIC_URL: process.env.PUBLIC_URL ?? "",
  // Shown in the privacy notice: who runs this radio and how to reach them.
  PRIVACY_CONTROLLER: process.env.PRIVACY_CONTROLLER ?? "",
  PRIVACY_CONTACT: process.env.PRIVACY_CONTACT ?? "",
};

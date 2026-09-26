function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const env = {
  DATABASE_URL: required("DATABASE_URL"),
  PORT: Number(process.env.PORT ?? 3000),
  MEDIAMTX_API: process.env.MEDIAMTX_API ?? "http://localhost:9997",
  MEDIAMTX_RTSP: process.env.MEDIAMTX_RTSP ?? "rtsp://localhost:8554",
  COOKIE_SECURE: process.env.COOKIE_SECURE === "true",
  CACHE_DIR: process.env.CACHE_DIR ?? "/tmp/lastradio-cache",
  CACHE_MAX_BYTES: Number(process.env.CACHE_MAX_BYTES ?? 2 * 1024 ** 3),
};

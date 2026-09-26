import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";

// DATABASE_URL must point at a throwaway database (scripts/test.sh uses the
// test stack's Postgres). It's dropped and recreated, then migrated.
export default async function setup() {
  const url = process.env.DATABASE_URL;
  if (!url || !/_it$|test/.test(new URL(url).pathname)) {
    throw new Error("Integration tests need DATABASE_URL pointing at a test database (name ending in _it)");
  }
  const dbName = new URL(url).pathname.slice(1);
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists "${dbName}" with (force)`);
  await admin.unsafe(`create database "${dbName}"`);
  await admin.end();

  const conn = postgres(url, { max: 1, onnotice: () => {} });
  await migrate(drizzle(conn), { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  await conn.end();
}

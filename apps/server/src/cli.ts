// Operator commands, run inside the api container:
//   docker compose exec api node dist/cli.js promote someone@example.com
//   docker compose exec api node dist/cli.js demote someone@example.com
//   docker compose exec api node dist/cli.js backfill-art [--retry-missing]
import { eq } from "drizzle-orm";
import { db, schema, sql } from "./db/index.js";
import { backfillArt } from "./lib/art-cache.js";

const [cmd, email] = process.argv.slice(2);

async function main() {
  if ((cmd === "promote" || cmd === "demote") && email) {
    const [u] = await db
      .update(schema.users)
      .set({ role: cmd === "promote" ? "admin" : "player" })
      .where(eq(schema.users.email, email.trim().toLowerCase()))
      .returning({ email: schema.users.email, role: schema.users.role });
    console.log(u ? `${u.email} is now ${u.role}` : `No user with email ${email}`);
    return;
  }
  if (cmd === "backfill-art") {
    // Song artwork for every song that has some, into the cache (see lib/art-cache.ts).
    let last = 0;
    const r = await backfillArt({
      retryMissing: process.argv.includes("--retry-missing"),
      onProgress: (done, total) => {
        if (done === total || Date.now() - last > 2000) {
          last = Date.now();
          console.log(`  ${done}/${total}`);
        }
      },
    });
    console.log(`${r.total} songs with artwork: ${r.alreadyCached} already cached, ${r.fetched} fetched, ${r.missing} unavailable (placeholder)`);
    return;
  }
  console.log("usage: cli.js promote|demote <email> | backfill-art [--retry-missing]");
  process.exitCode = 1;
}

main().finally(() => sql.end());

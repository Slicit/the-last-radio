// Operator commands, run inside the api container:
//   docker compose exec api node dist/cli.js promote someone@example.com
//   docker compose exec api node dist/cli.js demote someone@example.com
import { eq } from "drizzle-orm";
import { db, schema, sql } from "./db/index.js";

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
  console.log("usage: cli.js promote|demote <email>");
  process.exitCode = 1;
}

main().finally(() => sql.end());

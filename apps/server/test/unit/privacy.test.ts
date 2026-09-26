import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../../src/db/schema.js";
import { DATA_INVENTORY_HASH, POLICY_VERSION } from "../../src/lib/legal.js";

/** Every table and its columns, as one stable string. */
export function dataInventory(): string {
  return Object.values(schema)
    .filter((v): v is PgTable => is(v, PgTable))
    .map((t) => {
      const c = getTableConfig(t);
      return `${c.name}: ${c.columns.map((col) => col.name).sort().join(", ")}`;
    })
    .sort()
    .join("\n");
}

// specs/features/privacy.feature: "The privacy notice stays true"
describe("The privacy notice stays true", () => {
  it("is reviewed whenever what we store changes", () => {
    const hash = createHash("sha256").update(dataInventory()).digest("hex").slice(0, 16);
    expect(
      hash,
      `The database schema changed. Check the privacy notice (apps/web/src/pages/privacy.tsx) still describes
everything stored below, update it and POLICY_VERSION if not, then set DATA_INVENTORY_HASH in
apps/server/src/lib/legal.ts to "${hash}". See CLAUDE.md, "Privacy notice".

${dataInventory()}`,
    ).toBe(DATA_INVENTORY_HASH);
  });

  it("the page and the server agree on the notice's version", () => {
    const page = readFileSync(new URL("../../../web/src/pages/privacy.tsx", import.meta.url), "utf8");
    expect(page).toContain(`export const POLICY_VERSION = "${POLICY_VERSION}";`);
  });
});

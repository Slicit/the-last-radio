import { test as base, expect, type Page } from "@playwright/test";

export const asAdmin = { storageState: ".auth/admin.json" };
export const asPlayer = { storageState: ".auth/player.json" };

/** Fails the test on any uncaught page error (the randomUUID-style regressions). */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await use(page);
    expect(errors, "uncaught errors on the page").toEqual([]);
  },
});
export { expect };

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          // A fresh, migrated database per run (see global-setup.ts).
          globalSetup: ["test/integration/global-setup.ts"],
          setupFiles: ["test/integration/setup.ts"],
          // Keep emails in memory (lib/mail.ts) so tests can read them.
          env: { MAIL_CAPTURE: "1" },
          // One database: files run one after another.
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});

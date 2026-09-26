import { zValidator as zv } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";

/** zValidator that answers bad input with `{ error }` like every other route. */
export const zValidator = <T extends ZodType, K extends keyof ValidationTargets>(target: K, schema: T) =>
  zv(target, schema, (result, c) => {
    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue?.path.join(".");
      return c.json({ error: field ? `${field}: ${issue.message}` : (issue?.message ?? "Invalid input") }, 400);
    }
  });

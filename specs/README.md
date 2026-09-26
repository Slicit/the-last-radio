# Behaviour specs

These Gherkin features describe how The Last Radio behaves, journey by journey.
They are the reference when changing anything: if a change alters a scenario,
update the scenario in the same commit.

Each scenario is tagged with the layer that verifies it:

| Tag            | Verified by                                                        |
| -------------- | ------------------------------------------------------------------ |
| `@unit`        | `apps/server/test/unit` (Vitest, no database)                      |
| `@integration` | `apps/server/test/integration` (Vitest against a real Postgres)    |
| `@e2e`         | `e2e/` (Playwright driving the real app in a throwaway test stack) |
| `@manual`      | Checked by hand (see the scenario for how)                         |

Test names reuse the scenario titles, so `grep -r "<scenario title>"` finds
the test that proves it. Run everything with `scripts/test.sh`.

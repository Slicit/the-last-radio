# The Last Radio — project rules

## Privacy notice (must stay true)

The privacy & cookies notice (`apps/web/src/pages/privacy.tsx`, French and
English) describes exactly what the radio stores, why, for how long, who sees
it, and every cookie / local-storage key. Whenever a change affects any of that
(a new table or column, a new cookie or `localStorage` key, a new third party,
a retention change, new logging), in the same change:

1. Update both language versions of the notice.
2. Bump `POLICY_VERSION` (today's date, `YYYY-MM-DD`; add `.2`, `.3`… for
   another change the same day) in **both**
   `apps/web/src/pages/privacy.tsx` and `apps/server/src/lib/legal.ts`, and the
   `UPDATED` display date on the page. Everyone is then asked to acknowledge the
   notice again at their next sign-in.
3. If the database schema changed, set `DATA_INVENTORY_HASH` in
   `apps/server/src/lib/legal.ts` to the value the failing unit test prints
   (`apps/server/test/unit/privacy.test.ts`); that test exists to force this review.
4. Update `specs/features/privacy.feature` if behaviour changed.

## Specs and tests

- Behaviour lives in `specs/features/*.feature` (Gherkin). Change the scenario
  with the code, and keep test names equal to scenario titles.
- Run everything with `scripts/test.sh` (throwaway stack; never touches the live one).

## Deploying

- Always deploy with `scripts/deploy.sh` (add `--all` only when postgres or
  mediamtx configuration changed). Never a bare `docker compose up -d` on the
  live stack: when several services change, compose stops them all and waits
  for the broadcaster's drain, taking the site down (2026-09-26 outage).
- The broadcaster drains on restart: the song on air finishes first, and it
  gives up after 5 s if the stream server is unreachable.

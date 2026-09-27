/**
 * The privacy notice's version: the date it last changed. Bump it (and the
 * same constant in apps/web/src/pages/privacy.tsx) whenever the notice
 * changes; everyone is then asked to acknowledge it again at sign-in.
 * See CLAUDE.md, "Privacy notice".
 */
export const POLICY_VERSION = "2026-09-26.5";

/**
 * Fingerprint of every table and column in the database. A test recomputes
 * it: when the schema changes, the test fails until someone has checked the
 * privacy notice still describes what we store, then updates this value.
 */
export const DATA_INVENTORY_HASH = "129deb59f10e7774";

export const legalInfo = () => ({
  policyVersion: POLICY_VERSION,
  controller: process.env.PRIVACY_CONTROLLER || null,
  contact: process.env.PRIVACY_CONTACT || null,
});

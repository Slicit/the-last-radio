import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const roleEnum = pgEnum("role", ["admin", "player"]);

export const queueStatusEnum = pgEnum("queue_status", [
  "queued", // waiting in the playlist
  "playing", // currently on air
  "played", // finished normally
  "skipped", // cut short by an admin
  "removed", // withdrawn before airing
  "failed", // could not be fetched or decoded
]);

export const skipReasonEnum = pgEnum("skip_reason", [
  "admin", // an admin cut it
  "owner", // the person who added it changed their mind
  "votes", // enough listeners voted it off
  "interrupted", // the broadcaster restarted mid-song
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("player"),
  // UI theme: "night" (dark), "light" or "vintage".
  theme: text("theme").notNull().default("night"),
  // Set when the user has an avatar; doubles as its cache-busting version.
  avatarUpdatedAt: timestamp("avatar_updated_at", { withTimezone: true }),
  // Which privacy notice version they acknowledged, and when.
  privacyAckVersion: text("privacy_ack_version"),
  privacyAckAt: timestamp("privacy_ack_at", { withTimezone: true }),
  // Set once they clicked the link we emailed (or an admin vouched for them).
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  // Set when the account was deleted: the row stays, anonymised, so station history holds.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    // sha256 of the cookie token, so a leaked table can't be replayed.
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const radios = pgTable("radios", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  // Private stations are visible only to admins, members, and verified emails matching a domain rule.
  isPrivate: boolean("is_private").notNull().default(false),
  // A player may push at most `rateLimitCount` tracks per `rateLimitWindowSec`.
  rateLimitCount: integer("rate_limit_count").notNull().default(3),
  rateLimitWindowSec: integer("rate_limit_window_sec").notNull().default(600),
  maxTrackSec: integer("max_track_sec").notNull().default(600),
  // Share of current listeners whose votes skip the song on air; 0 disables voting.
  skipVotePercent: integer("skip_vote_percent").notNull().default(50),
  // Broadcast hours, in the station's own timezone. Outside them no new song
  // starts (the one on air finishes) and the queue waits for the next opening.
  hoursEnabled: boolean("hours_enabled").notNull().default(false),
  hoursDays: integer("hours_days").array().notNull().default(sql`'{1,2,3,4,5}'`), // 0 = Sunday
  hoursStart: text("hours_start").notNull().default("08:00"),
  hoursEnd: text("hours_end").notNull().default("18:00"), // before start = runs past midnight
  timezone: text("timezone").notNull().default("Europe/Paris"),
  // Alfred tops up the queue from past plays when less than this is lined up; 0 = off.
  autofillBelowSec: integer("autofill_below_sec").notNull().default(900),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tracks = pgTable("tracks", {
  id: uuid("id").primaryKey().defaultRandom(),
  // "<extractor>:<id>", e.g. "Youtube:dQw4w9WgXcQ" — stable across URL variants.
  sourceKey: text("source_key").notNull().unique(),
  sourceUrl: text("source_url").notNull(),
  title: text("title").notNull(),
  artist: text("artist"),
  durationSec: integer("duration_sec"),
  thumbnailUrl: text("thumbnail_url"),
  // Song health check: when yt-dlp last confirmed the source, and when it found it gone.
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  unavailableAt: timestamp("unavailable_at", { withTimezone: true }),
  unavailableReason: text("unavailable_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// The playlist and the play history are the same table: an item moves from
// queued -> playing -> played/skipped/failed, so stats are plain aggregates.
export const queueItems = pgTable(
  "queue_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    radioId: uuid("radio_id")
      .notNull()
      .references(() => radios.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id),
    // Null for songs Alfred (the fill-in bot) queued.
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    // Alfred's picks always play after songs people added.
    isFill: boolean("is_fill").notNull().default(false),
    status: queueStatusEnum("status").notNull().default("queued"),
    skipReason: skipReasonEnum("skip_reason"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    index("queue_radio_status_idx").on(t.radioId, t.status, t.createdAt),
    index("queue_user_radio_idx").on(t.userId, t.radioId, t.createdAt),
    // Only one item can be on air per radio.
    uniqueIndex("queue_one_playing_per_radio")
      .on(t.radioId)
      .where(sql`status = 'playing'`),
  ],
);

export const skipVotes = pgTable(
  "skip_votes",
  {
    queueItemId: uuid("queue_item_id")
      .notNull()
      .references(() => queueItems.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.queueItemId, t.userId] })],
);

// ---------------------------------------------------------------- API access
// Personal API keys and OAuth tokens share one table: a bearer token is
// looked up by its sha256, whatever issued it.

// Public OAuth clients (PKCE, no secret), created by dynamic client registration.
export const oauthClients = pgTable("oauth_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: text("redirect_uris").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tokenKindEnum = pgEnum("token_kind", ["api_key", "oauth_access", "oauth_refresh"]);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: tokenKindEnum("kind").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    // First characters of the token, so people can recognise their keys.
    prefix: text("prefix").notNull(),
    name: text("name"), // api keys only
    clientId: text("client_id").references(() => oauthClients.id, { onDelete: "cascade" }),
    scopes: text("scopes").array().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("api_tokens_user_idx").on(t.userId, t.kind)],
);

export const oauthCodes = pgTable("oauth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id")
    .notNull()
    .references(() => oauthClients.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  scopes: text("scopes").array().notNull(),
  resource: text("resource"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// ---------------------------------------------------------------- feedback

export const feedbackKindEnum = pgEnum("feedback_kind", ["idea", "bug", "other"]);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: feedbackKindEnum("kind").notNull().default("idea"),
    body: text("body").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("feedback_user_idx").on(t.userId, t.createdAt), index("feedback_inbox_idx").on(t.archivedAt, t.createdAt)],
);

// Admins' triage votes: +1 / -1 each, summed into a priority score.
export const feedbackVotes = pgTable(
  "feedback_votes",
  {
    feedbackId: uuid("feedback_id")
      .notNull()
      .references(() => feedback.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    value: integer("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.feedbackId, t.userId] })],
);

// ---------------------------------------------------------------- avatars

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

// Stored re-encoded (256×256 WebP, metadata stripped), never as uploaded.
export const avatars = pgTable("avatars", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  image: bytea("image").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------- private stations

export const radioMembers = pgTable(
  "radio_members",
  {
    radioId: uuid("radio_id")
      .notNull()
      .references(() => radios.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.radioId, t.userId] }), index("radio_members_user_idx").on(t.userId)],
);

// "Everyone with a verified @domain address may join this station."
export const radioDomains = pgTable(
  "radio_domains",
  {
    radioId: uuid("radio_id")
      .notNull()
      .references(() => radios.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(), // lowercase, e.g. "slic.it"
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.radioId, t.domain] })],
);

// ---------------------------------------------------------------- email verification

export const emailTokens = pgTable("email_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  email: text("email").notNull(), // the address it was sent to; must still match
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type User = typeof users.$inferSelect;
export type Radio = typeof radios.$inferSelect;
export type Track = typeof tracks.$inferSelect;
export type QueueItem = typeof queueItems.$inferSelect;

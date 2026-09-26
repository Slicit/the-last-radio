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

export type User = typeof users.$inferSelect;
export type Radio = typeof radios.$inferSelect;
export type Track = typeof tracks.$inferSelect;
export type QueueItem = typeof queueItems.$inferSelect;

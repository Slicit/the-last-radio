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
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: queueStatusEnum("status").notNull().default("queued"),
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


export type User = typeof users.$inferSelect;
export type Radio = typeof radios.$inferSelect;
export type Track = typeof tracks.$inferSelect;
export type QueueItem = typeof queueItems.$inferSelect;

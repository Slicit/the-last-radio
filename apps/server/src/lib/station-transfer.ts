import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import type { Radio } from "../db/schema.js";
import { isValidTimezone } from "./schedule.js";

// A whole station in one JSON file: its settings, who may listen, and every song
// it queued, played, skipped or lost, with the votes. Moving a station between
// instances (say, from a test server to the real one) is an export here and an
// import there.

const { radios, tracks, queueItems, skipVotes, songUpvotes, radioMembers, radioDomains, users } = schema;

export const TRANSFER_FORMAT = "the-last-radio.station";
export const TRANSFER_VERSION = 1;

const SETTINGS = [
  "name",
  "description",
  "isActive",
  "isPrivate",
  "rateLimitCount",
  "rateLimitWindowSec",
  "maxTrackSec",
  "skipVotePercent",
  "hoursEnabled",
  "hoursDays",
  "hoursStart",
  "hoursEnd",
  "timezone",
  "autofillBelowSec",
] as const;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const date = z.iso.datetime({ offset: true });

export const stationFile = z.object({
  format: z.literal(TRANSFER_FORMAT),
  version: z.literal(TRANSFER_VERSION),
  exportedAt: date,
  station: z.object({
    slug: z.string().max(40),
    name: z.string().trim().min(1).max(80),
    description: z.string().max(500),
    isActive: z.boolean(),
    isPrivate: z.boolean(),
    rateLimitCount: z.number().int().min(1).max(1000),
    rateLimitWindowSec: z.number().int().min(10).max(7 * 24 * 3600),
    maxTrackSec: z.number().int().min(30).max(4 * 3600),
    skipVotePercent: z.number().int().min(0).max(100),
    hoursEnabled: z.boolean(),
    hoursDays: z
      .array(z.number().int().min(0).max(6))
      .min(1)
      .max(7)
      .transform((d) => [...new Set(d)].sort()),
    hoursStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    hoursEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.string().max(64).refine(isValidTimezone, "Unknown timezone"),
    autofillBelowSec: z.number().int().min(0).max(4 * 3600),
    createdAt: date,
  }),
  access: z.object({
    domains: z.array(z.string().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(100),
    members: z.array(z.string()).max(10_000),
  }),
  // Everyone the history mentions. Former listeners (deleted accounts) come without an email.
  people: z
    .array(
      z.object({
        ref: z.string().max(20),
        email: z.email().max(254).nullable(),
        displayName: z.string().trim().min(1).max(80),
      }),
    )
    .max(10_000),
  songs: z
    .array(
      z.object({
        ref: z.string().max(20),
        sourceKey: z.string().min(1).max(300),
        sourceUrl: z.url().max(2000).refine((u) => /^https?:\/\//i.test(u), "Only http(s) links"),
        title: z.string().max(500),
        artist: z.string().max(300).nullable(),
        durationSec: z.number().int().min(0).nullable(),
        thumbnailUrl: z.string().max(2000).nullable(),
        checkedAt: date.nullable(),
        unavailableAt: date.nullable(),
        unavailableReason: z.string().max(1000).nullable(),
      }),
    )
    .max(100_000),
  // The queue and the history: one entry per time a song was lined up.
  plays: z
    .array(
      z.object({
        song: z.string(),
        by: z.string().nullable(), // null: Alfred
        isFill: z.boolean(),
        status: z.enum(["queued", "playing", "played", "skipped", "removed", "failed"]),
        skipReason: z.enum(["admin", "owner", "votes", "interrupted"]).nullable(),
        error: z.string().max(2000).nullable(),
        createdAt: date,
        startedAt: date.nullable(),
        endedAt: date.nullable(),
        downvotes: z.array(z.object({ by: z.string(), at: date })).max(10_000),
      }),
    )
    .max(500_000),
  upvotes: z.array(z.object({ song: z.string(), by: z.string(), at: date })).max(500_000),
});

export type StationFile = z.infer<typeof stationFile>;

/** Everything about one station, ready to be saved as a file. */
export async function exportStation(radio: Radio): Promise<StationFile> {
  const [items, votes, ups, members, domains] = await Promise.all([
    db.select().from(queueItems).where(eq(queueItems.radioId, radio.id)).orderBy(asc(queueItems.createdAt)),
    db
      .select({ itemId: skipVotes.queueItemId, userId: skipVotes.userId, at: skipVotes.createdAt })
      .from(skipVotes)
      .innerJoin(queueItems, eq(queueItems.id, skipVotes.queueItemId))
      .where(eq(queueItems.radioId, radio.id))
      .orderBy(asc(skipVotes.createdAt)),
    db.select().from(songUpvotes).where(eq(songUpvotes.radioId, radio.id)).orderBy(asc(songUpvotes.createdAt)),
    db.select().from(radioMembers).where(eq(radioMembers.radioId, radio.id)).orderBy(asc(radioMembers.addedAt)),
    db.select().from(radioDomains).where(eq(radioDomains.radioId, radio.id)).orderBy(asc(radioDomains.addedAt)),
  ]);

  // Short references keep the file small and readable: p1, p2… and s1, s2…
  const refs = (prefix: string) => {
    const map = new Map<string, string>();
    const ref = (id: string) => {
      let r = map.get(id);
      if (!r) map.set(id, (r = `${prefix}${map.size + 1}`));
      return r;
    };
    return { map, ref };
  };
  const person = refs("p");
  const song = refs("s");

  const votesByItem = new Map<string, { by: string; at: string }[]>();
  for (const v of votes) {
    const list = votesByItem.get(v.itemId) ?? [];
    list.push({ by: person.ref(v.userId), at: v.at.toISOString() });
    votesByItem.set(v.itemId, list);
  }
  const plays = items.map((i) => ({
    song: song.ref(i.trackId),
    by: i.userId ? person.ref(i.userId) : null,
    isFill: i.isFill,
    status: i.status,
    skipReason: i.skipReason,
    error: i.error,
    createdAt: i.createdAt.toISOString(),
    startedAt: iso(i.startedAt),
    endedAt: iso(i.endedAt),
    downvotes: votesByItem.get(i.id) ?? [],
  }));
  const upvotes = ups.map((u) => ({ song: song.ref(u.trackId), by: person.ref(u.userId), at: u.createdAt.toISOString() }));
  const memberRefs = members.map((m) => person.ref(m.userId));

  const [people, songs] = await Promise.all([
    person.map.size
      ? db.select().from(users).where(inArray(users.id, [...person.map.keys()]))
      : Promise.resolve([] as (typeof users.$inferSelect)[]),
    song.map.size
      ? db.select().from(tracks).where(inArray(tracks.id, [...song.map.keys()]))
      : Promise.resolve([] as (typeof tracks.$inferSelect)[]),
  ]);
  const byRef = <R extends { id: string }>(rows: R[], map: Map<string, string>) =>
    rows.sort((a, b) => Number(map.get(a.id)!.slice(1)) - Number(map.get(b.id)!.slice(1)));

  return {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    station: {
      slug: radio.slug,
      ...Object.fromEntries(SETTINGS.map((k) => [k, radio[k]])),
      createdAt: radio.createdAt.toISOString(),
    } as StationFile["station"],
    access: { domains: domains.map((d) => d.domain), members: memberRefs },
    people: byRef(people, person.map).map((u) => ({
      ref: person.map.get(u.id)!,
      email: u.deletedAt ? null : u.email,
      displayName: u.displayName,
    })),
    songs: byRef(songs, song.map).map((t) => ({
      ref: song.map.get(t.id)!,
      sourceKey: t.sourceKey,
      sourceUrl: t.sourceUrl,
      title: t.title,
      artist: t.artist,
      durationSec: t.durationSec,
      thumbnailUrl: t.thumbnailUrl,
      checkedAt: iso(t.checkedAt),
      unavailableAt: iso(t.unavailableAt),
      unavailableReason: t.unavailableReason,
    })),
    plays,
    upvotes,
  };
}

export type ImportSummary = {
  songs: number;
  newSongs: number;
  plays: number;
  queued: number;
  people: { matched: number; placeholders: number };
  downvotes: number;
  upvotes: number;
};

const chunks = <T>(rows: T[], size = 1000) =>
  Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));

const bad = (message: string) => new HTTPException(400, { message });

/**
 * Recreates a station from an export, as a new station. Songs this instance
 * already knows are reused; people are matched to accounts by email, and anyone
 * without an account here keeps their name on a placeholder that can't sign in.
 */
export async function importStation(
  file: StationFile,
  opts: { slug: string; name?: string },
): Promise<{ radio: Radio; summary: ImportSummary }> {
  const people = new Map(file.people.map((p) => [p.ref, p]));
  const songs = new Map(file.songs.map((s) => [s.ref, s]));
  const knownPerson = (ref: string) => {
    if (!people.has(ref)) throw bad(`The file mentions someone it doesn't describe (${ref})`);
  };
  const knownSong = (ref: string) => {
    if (!songs.has(ref)) throw bad(`The file mentions a song it doesn't describe (${ref})`);
  };
  for (const p of file.plays) {
    knownSong(p.song);
    if (p.by) knownPerson(p.by);
    p.downvotes.forEach((v) => knownPerson(v.by));
  }
  for (const u of file.upvotes) {
    knownSong(u.song);
    knownPerson(u.by);
  }
  file.access.members.forEach(knownPerson);
  // A song on air when the file was made goes back to the front of the line.
  const onAir = file.plays.filter((p) => p.status === "playing");
  if (onAir.length > 1) throw bad("The file has more than one song on air");

  return db.transaction(async (tx) => {
    const { createdAt, slug: _, ...settings } = file.station;
    const [radio] = await tx
      .insert(radios)
      .values({ ...settings, slug: opts.slug, name: opts.name ?? settings.name, createdAt: new Date(createdAt) })
      .onConflictDoNothing()
      .returning();
    if (!radio) throw new HTTPException(409, { message: "That slug is taken" });

    // Songs, by their stable source key.
    const songIds = new Map<string, string>();
    let newSongs = 0;
    for (const batch of chunks(file.songs)) {
      const inserted = await tx
        .insert(tracks)
        .values(
          batch.map((s) => ({
            sourceKey: s.sourceKey,
            sourceUrl: s.sourceUrl,
            title: s.title,
            artist: s.artist,
            durationSec: s.durationSec,
            thumbnailUrl: s.thumbnailUrl,
            checkedAt: s.checkedAt ? new Date(s.checkedAt) : null,
            unavailableAt: s.unavailableAt ? new Date(s.unavailableAt) : null,
            unavailableReason: s.unavailableReason,
          })),
        )
        .onConflictDoNothing({ target: tracks.sourceKey })
        .returning({ id: tracks.id });
      newSongs += inserted.length;
      const rows = await tx
        .select({ id: tracks.id, sourceKey: tracks.sourceKey })
        .from(tracks)
        .where(inArray(tracks.sourceKey, batch.map((s) => s.sourceKey)));
      const byKey = new Map(rows.map((r) => [r.sourceKey, r.id]));
      for (const s of batch) songIds.set(s.ref, byKey.get(s.sourceKey)!);
    }

    // People: an account with the same email, or a placeholder.
    const userIds = new Map<string, string>();
    const emails = [...new Set(file.people.flatMap((p) => (p.email ? [p.email.toLowerCase()] : [])))];
    const accounts = new Map<string, string>();
    for (const batch of chunks(emails)) {
      const rows = await tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(and(inArray(users.email, batch), isNull(users.deletedAt)));
      rows.forEach((r) => accounts.set(r.email.toLowerCase(), r.id));
    }
    const placeholders: (typeof users.$inferInsert)[] = [];
    for (const p of file.people) {
      const match = p.email ? accounts.get(p.email.toLowerCase()) : undefined;
      if (match) {
        userIds.set(p.ref, match);
        continue;
      }
      const id = randomUUID();
      userIds.set(p.ref, id);
      placeholders.push({
        id,
        email: `imported-${id}@imported.invalid`,
        displayName: p.email ? p.displayName : "Former listener",
        passwordHash: "!", // matches no password: nobody can sign in as a placeholder
        deletedAt: new Date(),
      });
    }
    for (const batch of chunks(placeholders)) await tx.insert(users).values(batch);

    // The queue and history, then the downvotes on each entry.
    const items = file.plays.map((p) => {
      const playing = p.status === "playing";
      return {
        id: randomUUID(),
        radioId: radio.id,
        trackId: songIds.get(p.song)!,
        userId: p.by ? userIds.get(p.by)! : null,
        isFill: p.isFill,
        status: playing ? ("queued" as const) : p.status,
        skipReason: p.skipReason,
        error: p.error,
        createdAt: new Date(p.createdAt),
        startedAt: playing || !p.startedAt ? null : new Date(p.startedAt),
        endedAt: playing || !p.endedAt ? null : new Date(p.endedAt),
        downvotes: p.downvotes,
      };
    });
    for (const batch of chunks(items)) await tx.insert(queueItems).values(batch.map(({ downvotes: _, ...i }) => i));
    const votes = items.flatMap((i) =>
      i.downvotes.map((v) => ({ queueItemId: i.id, userId: userIds.get(v.by)!, createdAt: new Date(v.at) })),
    );
    for (const batch of chunks(votes)) await tx.insert(skipVotes).values(batch).onConflictDoNothing();

    const ups = file.upvotes.map((u) => ({
      userId: userIds.get(u.by)!,
      radioId: radio.id,
      trackId: songIds.get(u.song)!,
      createdAt: new Date(u.at),
    }));
    for (const batch of chunks(ups)) await tx.insert(songUpvotes).values(batch).onConflictDoNothing();

    const members = [...new Set(file.access.members.map((m) => userIds.get(m)!))].map((userId) => ({ radioId: radio.id, userId }));
    if (members.length) await tx.insert(radioMembers).values(members).onConflictDoNothing();
    const domains = [...new Set(file.access.domains)].map((domain) => ({ radioId: radio.id, domain }));
    if (domains.length) await tx.insert(radioDomains).values(domains).onConflictDoNothing();

    return {
      radio,
      summary: {
        songs: file.songs.length,
        newSongs,
        plays: items.filter((i) => i.status !== "queued").length,
        queued: items.filter((i) => i.status === "queued").length,
        people: { matched: file.people.length - placeholders.length, placeholders: placeholders.length },
        downvotes: votes.length,
        upvotes: ups.length,
      },
    };
  });
}

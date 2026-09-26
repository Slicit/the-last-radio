import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

export type SongSort = "played" | "score" | "downvoted" | "recent";

export type SongRecord = {
  track: {
    id: string;
    title: string;
    artist: string | null;
    durationSec: number | null;
    thumbnailUrl: string | null;
    sourceUrl: string;
    sourceKey: string;
  };
  plays: number; // aired to the end
  playsByPeople: number;
  playsByAlfred: number;
  airings: number; // started at all
  adders: number; // distinct people who added it
  downvotes: number; // every skip vote cast against it
  skips: number; // voted off or cut by an admin
  lastPlayedAt: string | null;
  /** How the latest airing ended: played, votes, admin, owner, interrupted or playing. */
  lastOutcome: string | null;
  score: number;
  /** Whether Alfred may pick it (duration and recency aside). */
  alfredOk: boolean;
};

/**
 * The score Alfred ranks songs by. People's opinions dominate: adding a song
 * is the strongest signal, a play to the end counts, and each downvote or
 * forced skip counts against. Alfred's own replays count half so his picks
 * don't snowball just because he picked them.
 */
const SCORE = sql`(
  count(*) filter (where qi.status = 'played' and not qi.is_fill)
  + 0.5 * count(*) filter (where qi.status = 'played' and qi.is_fill)
  + 2 * count(distinct qi.user_id) filter (where not qi.is_fill)
  - coalesce(sum(v.n), 0)
  - 3 * count(*) filter (where qi.skip_reason in ('votes', 'admin'))
)`;

const ORDER: Record<SongSort, ReturnType<typeof sql>> = {
  played: sql`plays desc, score desc`,
  score: sql`score desc, plays desc`,
  downvoted: sql`downvotes desc, skips desc`,
  recent: sql`last_played_at desc nulls last`,
};

/** Every song this station has aired, with its record. */
export async function songRecords(radioId: string, sort: SongSort = "played", limit = 200): Promise<SongRecord[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select
      t.id, t.title, t.artist, t.duration_sec, t.thumbnail_url, t.source_url, t.source_key,
      count(*) filter (where qi.status = 'played')::int as plays,
      count(*) filter (where qi.status = 'played' and not qi.is_fill)::int as plays_by_people,
      count(*) filter (where qi.status = 'played' and qi.is_fill)::int as plays_by_alfred,
      count(*) filter (where qi.started_at is not null)::int as airings,
      count(distinct qi.user_id) filter (where not qi.is_fill)::int as adders,
      coalesce(sum(v.n), 0)::int as downvotes,
      count(*) filter (where qi.skip_reason in ('votes', 'admin'))::int as skips,
      max(qi.started_at) as last_played_at,
      (array_agg(coalesce(qi.skip_reason::text, qi.status::text) order by qi.started_at desc)
        filter (where qi.started_at is not null))[1] as last_outcome,
      ${SCORE}::float as score
    from queue_items qi
    join tracks t on t.id = qi.track_id
    left join (select queue_item_id, count(*) as n from skip_votes group by 1) v on v.queue_item_id = qi.id
    where qi.radio_id = ${radioId} and qi.status <> 'removed'
    group by t.id
    having count(*) filter (where qi.started_at is not null) > 0
    order by ${ORDER[sort]}
    limit ${limit}
  `);
  return rows.map((r) => {
    const score = Number(r.score);
    const lastOutcome = (r.last_outcome as string | null) ?? null;
    return {
      track: {
        id: r.id as string,
        title: r.title as string,
        artist: (r.artist as string | null) ?? null,
        durationSec: (r.duration_sec as number | null) ?? null,
        thumbnailUrl: (r.thumbnail_url as string | null) ?? null,
        sourceUrl: r.source_url as string,
        sourceKey: r.source_key as string,
      },
      plays: r.plays as number,
      playsByPeople: r.plays_by_people as number,
      playsByAlfred: r.plays_by_alfred as number,
      airings: r.airings as number,
      adders: r.adders as number,
      downvotes: r.downvotes as number,
      skips: r.skips as number,
      lastPlayedAt: r.last_played_at ? new Date(r.last_played_at as string).toISOString() : null,
      lastOutcome,
      score: Math.round(score * 10) / 10,
      alfredOk: score > 0 && lastOutcome !== "votes" && lastOutcome !== "admin",
    };
  });
}

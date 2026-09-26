import { useState } from "react";
import { Bot, Ban, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrackArt } from "@/components/track-art";
import { AddAgain, type Lineup } from "@/components/add-again";
import { UpvoteButton } from "@/components/upvote-button";
import { useSongs } from "@/hooks/use-radio";
import type { SongRecord, SongSort } from "@/lib/api";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Pager } from "@/components/pager";

const SORTS: { value: SongSort; label: string }[] = [
  { value: "played", label: "Most played" },
  { value: "score", label: "Crowd favourites" },
  { value: "downvoted", label: "Most downvoted" },
  { value: "recent", label: "Recently played" },
];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "5 plays · added by 3 people · 2 downvotes · skipped once" */
function recordLine(s: SongRecord): string {
  const parts = [plural(s.plays, "play")];
  if (s.adders) parts.push(`added by ${plural(s.adders, "person", "people")}`);
  if (s.upvotes) parts.push(plural(s.upvotes, "upvote"));
  if (s.downvotes) parts.push(plural(s.downvotes, "downvote"));
  if (s.skips) parts.push(s.skips === 1 ? "skipped once" : `skipped ${s.skips}×`);
  return parts.join(" · ");
}

/** Why Alfred leaves a song alone, in words. */
function alfredVerdict(s: SongRecord): string | null {
  if (s.unavailable) return "No longer available";
  if (s.alfredOk) return null;
  if (s.lastOutcome === "votes") return "Voted off";
  if (s.lastOutcome === "admin") return "Admin skipped it";
  return "Too many downvotes";
}

/** Every song the station has played, with its record, and a way to bring one back. */
export function SongsList({ slug, lineup }: { slug: string; lineup: Lineup }) {
  const [sort, setSortState] = useState<SongSort>("played");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const setSort = (s: SongSort) => {
    setSortState(s);
    setPage(1);
  };
  const { data: pageData, isLoading, isFetching } = useSongs(slug, sort, page, pageSize);
  const data = pageData?.items;
  const offset = (page - 1) * pageSize;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Sort songs">
        {SORTS.map((s) => (
          <Button
            key={s.value}
            size="sm"
            role="radio"
            aria-checked={sort === s.value}
            variant={sort === s.value ? "secondary" : "ghost"}
            onClick={() => setSort(s.value)}
          >
            {s.label}
          </Button>
        ))}
        <span className="ml-auto hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
          <Bot className="size-3.5" /> Alfred replays the favourites when the queue runs low
        </span>
      </div>
      <Card>
        <CardContent className={cn("divide-y transition-opacity", isFetching && !isLoading && "opacity-70")}>
          {isLoading ? (
            <Skeleton className="h-40" />
          ) : !data?.length ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No songs have played here yet.</div>
          ) : (
            data.map((s, i) => {
              const verdict = alfredVerdict(s);
              return (
                <div key={s.track.id} className="flex items-center gap-3 py-2.5">
                  <span className="w-5 shrink-0 text-right text-sm font-semibold text-muted-foreground tabular-nums">
                    {offset + i + 1}
                  </span>
                  <TrackArt src={s.track.thumbnailUrl} className="size-11" />
                  <div className="min-w-0 flex-1">
                    <a
                      href={s.track.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {s.track.title}
                    </a>
                    <div className="truncate text-xs text-muted-foreground">
                      {s.downvotes > 0 && sort === "downvoted" && (
                        <ThumbsDown className="mr-1 inline size-3 align-[-2px]" />
                      )}
                      {recordLine(s)}
                      {verdict && <span className="sm:hidden"> · Alfred passes</span>}
                    </div>
                  </div>
                  <div className="hidden w-32 shrink-0 text-right text-xs text-muted-foreground sm:block">
                    {s.lastPlayedAt && <div>{ago(s.lastPlayedAt)}</div>}
                    {verdict && (
                      <div
                        className="flex items-center justify-end gap-1 text-muted-foreground/80"
                        title="Alfred won't pick this song when he fills the queue"
                      >
                        <Ban className="size-3" /> {verdict}
                      </div>
                    )}
                  </div>
                  <UpvoteButton state={lineup.upvote} trackId={s.track.id} count={s.upvotes} />
                  <AddAgain lineup={lineup} track={{ ...s.track, unavailable: s.unavailable }} />
                </div>
              );
            })
          )}
          <Pager page={page} pageSize={pageSize} total={pageData?.total ?? 0} onPage={setPage} onPageSize={setPageSize} label="songs" />
        </CardContent>
      </Card>
    </div>
  );
}

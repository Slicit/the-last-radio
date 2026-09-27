import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useAddSong } from "@/hooks/use-add-song";
import { Link2, Loader2, Plus, Search, TriangleAlert, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { TrackArt } from "@/components/track-art";
import { api, type QueueItem, type Quota, type SearchResult, type SearchSource } from "@/lib/api";
import { duration } from "@/lib/format";
import { cn } from "@/lib/utils";

type Option =
  | { kind: "song"; key: string; url: string; song: SearchResult; blocked: string | null }
  | { kind: "link"; key: string; url: string; blocked: null };

const DEBOUNCE_MS = 350;
const SOURCES: { value: SearchSource; label: string }[] = [
  { value: "youtube", label: "YouTube" },
  { value: "soundcloud", label: "SoundCloud" },
];

function storedSource(): SearchSource {
  try {
    return localStorage.getItem("lr_search_source") === "soundcloud" ? "soundcloud" : "youtube";
  } catch {
    return "youtube";
  }
}
const isLink = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Search-as-you-type song picker. Typing searches YouTube; pasting a link
 * offers to add that link directly. Songs that can't be added stay visible
 * with the reason, so nobody wonders why their pick is missing.
 */
export function SongSearch({
  slug,
  maxTrackSec,
  quota,
  queuedKeys,
  nowPlaying,
  waitLabel,
}: {
  slug: string;
  maxTrackSec: number;
  quota: Quota | null;
  queuedKeys: string[];
  nowPlaying: QueueItem | null;
  /** Set when the user has used up their adds; replaces the input with a countdown. */
  waitLabel: string | null;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [source, setSourceState] = useState<SearchSource>(storedSource);
  const setSource = (s: SearchSource) => {
    setSourceState(s);
    try {
      localStorage.setItem("lr_search_source", s);
    } catch {
      /* private mode */
    }
    inputRef.current?.focus();
    setOpen(true);
  };
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const trimmed = query.trim();
  const link = isLink(trimmed);
  const debounced = useDebounced(trimmed, DEBOUNCE_MS);
  const searching = !link && debounced.length >= 2;

  const search = useQuery({
    queryKey: ["search", source, debounced.toLowerCase()],
    queryFn: ({ signal }) =>
      api.get<{ results?: SearchResult[]; source?: SearchSource; fallbackFrom?: SearchSource }>(
        `/search?q=${encodeURIComponent(debounced)}&source=${source}`,
        signal,
      ),
    enabled: searching,
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
    retry: false,
  });

  const add = useAddSong(slug, () => {
    setQuery("");
    setOpen(false);
    setActive(-1);
  });

  const options: Option[] = useMemo(() => {
    if (link) return [{ kind: "link", key: "link", url: trimmed, blocked: null }];
    if (!searching) return [];
    const inLine = new Set(queuedKeys);
    return (search.data?.results ?? []).map((song) => ({
      kind: "song" as const,
      key: song.sourceKey,
      url: song.sourceUrl,
      song,
      blocked:
        song.sourceKey === nowPlaying?.track.sourceKey
          ? "On air now"
          : inLine.has(song.sourceKey)
            ? "Already in line"
            : (song.durationSec ?? 0) > maxTrackSec
              ? `Over ${Math.round(maxTrackSec / 60)} min`
              : null,
    }));
  }, [link, trimmed, searching, search.data, queuedKeys, nowPlaying, maxTrackSec]);

  // "Find it" on an unavailable song: search for it here.
  useEffect(() => {
    const onFind = (e: Event) => {
      setQuery((e as CustomEvent<string>).detail);
      setOpen(true);
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    window.addEventListener("lr:find-song", onFind);
    return () => window.removeEventListener("lr:find-song", onFind);
  }, []);

  // Highlight the first addable result whenever the list changes.
  useEffect(() => {
    setActive(options.findIndex((o) => !o.blocked));
  }, [options]);

  useEffect(() => {
    if (active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  const pick = (opt: Option | undefined) => {
    if (!opt || opt.blocked || add.isPending) return;
    add.mutate({ key: opt.key, target: { url: opt.url } });
  };

  const move = (dir: 1 | -1) => {
    const n = options.length;
    if (!n) return;
    for (let step = 1; step <= n; step++) {
      const i = (active + dir * step + n) % n;
      if (!options[i].blocked) return setActive(i);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === "Escape") {
      if (open) setOpen(false);
      else setQuery("");
    }
  };

  const typing = trimmed !== debounced && !link;
  const loading = !link && trimmed.length >= 2 && (search.isFetching || typing);
  const firstLoad = loading && !search.data;
  const showPanel = open && (link || trimmed.length >= 2);
  const stale = search.isPlaceholderData || typing;

  if (waitLabel) {
    return (
      <div className="flex h-11 items-center gap-2 rounded-lg border border-dashed px-3 text-sm text-muted-foreground">
        <Search className="size-4 shrink-0" />
        {waitLabel}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="mb-2 flex items-center gap-1 text-xs text-muted-foreground" role="radiogroup" aria-label="Search on">
        <span className="mr-1">Search on</span>
        {SOURCES.map((s) => (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={source === s.value}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setSource(s.value)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 transition-colors",
              source === s.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:border-foreground/40 hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showPanel && active >= 0 ? `${listId}-${active}` : undefined}
          aria-label="Search for a song"
          placeholder={`Search ${source === "soundcloud" ? "SoundCloud" : "YouTube"}, or paste a link…`}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            // On phones the keyboard covers half the screen: bring the box to the top
            // so the results have room below it.
            if (window.matchMedia("(max-width: 640px)").matches) {
              window.setTimeout(() => inputRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 250);
            }
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="h-11 w-full scroll-mt-20 rounded-lg border border-input bg-transparent pr-10 pl-9 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
        />
        <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center">
          {loading || add.isPending ? (
            <Loader2 className="mr-1 size-4 animate-spin text-muted-foreground" />
          ) : query ? (
            <button
              type="button"
              aria-label="Clear search"
              className="rounded p-1 text-muted-foreground hover:text-foreground"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        {showPanel && (
          <div
            className="absolute inset-x-0 top-full z-50 mt-1.5 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
            // Keep focus in the input so blur doesn't close the list mid-click.
            onMouseDown={(e) => e.preventDefault()}
          >
            {searching && search.data?.fallbackFrom === "youtube" && (
              <p role="status" className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                <TriangleAlert className="size-3.5 shrink-0" />
                YouTube isn't reachable right now, so here are SoundCloud results. Links from either still work.
              </p>
            )}
            <ul id={listId} role="listbox" aria-label="Songs" className="max-h-[26rem] overflow-y-auto p-1">
              {firstLoad &&
                [0, 1, 2].map((i) => (
                  <li key={i} className="flex items-center gap-3 p-2" aria-hidden>
                    <Skeleton className="h-10 w-16 rounded" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-4/5" />
                      <Skeleton className="h-3 w-2/5" />
                    </div>
                  </li>
                ))}

              {options.map((opt, i) => (
                <li
                  key={opt.key}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={!!opt.blocked}
                  onMouseEnter={() => !opt.blocked && setActive(i)}
                  onClick={() => pick(opt)}
                  className={cn(
                    "flex items-center gap-3 rounded-md p-2 transition-opacity",
                    opt.blocked ? "cursor-default opacity-50" : "cursor-pointer",
                    i === active && !opt.blocked && "bg-accent text-accent-foreground",
                    stale && "opacity-60",
                  )}
                >
                  {opt.kind === "link" ? (
                    <>
                      <div className="flex h-10 w-16 shrink-0 items-center justify-center rounded bg-muted">
                        <Link2 className="size-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">Add this link</div>
                        <div className="truncate text-xs text-muted-foreground">{opt.url}</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="relative shrink-0">
                        <TrackArt src={opt.song.thumbnailUrl} className="h-10 w-16 rounded" />
                        <span className="absolute right-0.5 bottom-0.5 rounded bg-black/75 px-1 text-[0.6rem] leading-tight font-medium text-white tabular-nums">
                          {duration(opt.song.durationSec)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-2 text-sm leading-snug font-medium">{opt.song.title}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {opt.song.artist}
                          {opt.song.views != null && <> · {compact.format(opt.song.views)} views</>}
                        </div>
                      </div>
                    </>
                  )}
                  <div className="shrink-0 text-xs">
                    {opt.blocked ? (
                      <span className="text-muted-foreground">{opt.blocked}</span>
                    ) : add.isPending && add.variables?.key === opt.key ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Plus className={cn("size-4", i === active ? "opacity-100" : "opacity-40")} />
                    )}
                  </div>
                </li>
              ))}

              {searching && !loading && !search.isError && options.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Nothing found for “{debounced}” on {source === "soundcloud" ? "SoundCloud" : "YouTube"}. Try the artist
                  and the song title, the other service, or paste a link.
                </li>
              )}
              {search.isError && !loading && (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {search.error.message}. You can also paste a link.
                </li>
              )}
            </ul>
            {options.length > 0 && (
              <div className="hidden items-center justify-between border-t px-3 py-1.5 text-[0.7rem] text-muted-foreground sm:flex">
                <span>
                  <kbd className="font-sans">↑↓</kbd> choose · <kbd className="font-sans">Enter</kbd> add ·{" "}
                  <kbd className="font-sans">Esc</kbd> close
                </span>
                <span>from {(search.data?.source ?? source) === "soundcloud" ? "SoundCloud" : "YouTube"}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {quota && (
        <p className="mt-2 text-xs text-muted-foreground">
          {quota.unlimited ? (
            "Admin: add as many as you like."
          ) : (
            <>
              You can add <span className="font-medium text-foreground">{quota.remaining}</span> more{" "}
              {quota.remaining === 1 ? "song" : "songs"} right now.
            </>
          )}
        </p>
      )}

    </div>
  );
}

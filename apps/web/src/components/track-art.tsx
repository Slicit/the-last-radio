import { useState } from "react";
import { Disc3 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Where a song's artwork is served from: our own cache, never the music site
 * itself (so listeners' browsers don't contact YouTube, SoundCloud…).
 */
export const artUrl = (t: { sourceKey?: string; thumbnailUrl?: string | null } | null | undefined) =>
  t?.sourceKey && t.thumbnailUrl ? `/api/art/${encodeURIComponent(t.sourceKey)}` : null;

/** A song's artwork, or a disc placeholder when there's none (or it can't be loaded). */
export function TrackArt({ src, className }: { src: string | null | undefined; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const show = src && failed !== src;
  return (
    <div className={cn("relative shrink-0 overflow-hidden rounded-md bg-muted", className)}>
      {show ? (
        <img src={src} alt="" loading="lazy" className="size-full object-cover" onError={() => setFailed(src)} />
      ) : (
        <Disc3 className="absolute inset-0 m-auto size-1/2 text-muted-foreground" />
      )}
    </div>
  );
}

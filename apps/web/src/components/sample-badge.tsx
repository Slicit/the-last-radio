import { cn } from "@/lib/utils";

/**
 * "SAMPLE": SoundCloud only lets us play 30 seconds of this song (a Go+
 * preview). Loud on purpose, in every theme, so nobody queues it expecting
 * the whole song.
 */
export function SampleBadge({ className }: { className?: string }) {
  return (
    <span
      title="Only a 30-second sample of this song can be played (a SoundCloud preview)"
      aria-label="Sample: only 30 seconds play"
      className={cn(
        "inline-flex h-4.5 shrink-0 items-center rounded-full bg-amber-400 px-1.5 align-middle text-[0.625rem] font-bold tracking-wider text-black uppercase ring-1 ring-amber-600/40",
        className,
      )}
    >
      Sample
    </span>
  );
}

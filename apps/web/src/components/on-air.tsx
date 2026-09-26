import { cn } from "@/lib/utils";

/** Red "on air" pill; grey when the stream isn't being published. */
export function OnAir({ live, closed, className }: { live: boolean; closed?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold tracking-widest uppercase",
        live ? "bg-red-500/15 text-red-500" : "bg-muted text-muted-foreground",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", live ? "animate-pulse bg-red-500" : "bg-muted-foreground")} />
      {live ? "On air" : closed ? "Closed" : "Off air"}
    </span>
  );
}

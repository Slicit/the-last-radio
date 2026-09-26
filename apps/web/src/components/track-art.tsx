import { Disc3 } from "lucide-react";
import { cn } from "@/lib/utils";

export function TrackArt({ src, className }: { src: string | null | undefined; className?: string }) {
  return (
    <div className={cn("relative shrink-0 overflow-hidden rounded-md bg-muted", className)}>
      {src ? (
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
      ) : (
        <Disc3 className="absolute inset-0 m-auto size-1/2 text-muted-foreground" />
      )}
    </div>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";

type Target = { url: string } | { trackId: string };

const ordinal = (n: number) => {
  const suffix = { one: "st", two: "nd", few: "rd", other: "th" } as Record<string, string>;
  return `${n}${suffix[new Intl.PluralRules("en", { type: "ordinal" }).select(n)] ?? "th"}`;
};

/** Adds a song to a station's line-up, with the same confirmation everywhere. */
export function useAddSong(slug: string, onAdded?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    // `key` only lets callers tell which row is busy.
    mutationFn: ({ target }: { key: string; target: Target }) =>
      api.post<{ track: { title: string }; position: number }>(`/radios/${slug}/queue`, target),
    onSuccess: (d) => {
      toast.success(`“${d.track.title}” added`, {
        description: d.position === 1 ? "It's next up." : `It's ${ordinal(d.position)} in line.`,
      });
      qc.invalidateQueries({ queryKey: ["radio", slug] });
      onAdded?.();
    },
    onError: (e) => toast.error(e.message),
  });
}

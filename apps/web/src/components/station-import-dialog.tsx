import { useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRadios } from "@/hooks/use-radio";
import { api, type Radio } from "@/lib/api";

const MAX_BYTES = 50 * 1024 * 1024;

/** Just what the dialog shows; the server checks the whole file. */
type StationFile = {
  format: string;
  exportedAt: string;
  station: { slug: string; name: string; isPrivate: boolean };
  people: unknown[];
  songs: unknown[];
  plays: { status: string }[];
  upvotes: unknown[];
};

type Summary = {
  songs: number;
  newSongs: number;
  plays: number;
  queued: number;
  people: { matched: number; placeholders: number };
  downvotes: number;
  upvotes: number;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** A slug nobody uses yet: the file's own, or the same with -2, -3… */
function freeSlug(wanted: string, taken: Set<string>) {
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) {
    const candidate = `${wanted.slice(0, 36)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** "Import station": recreate a station, with its whole history, from an export file. */
export function StationImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: radios } = useRadios();
  const [file, setFile] = useState<StationFile | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");

  const reset = () => {
    setFile(null);
    setProblem(null);
    setSlug("");
    setName("");
  };

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    reset();
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_BYTES) return setProblem("That file is over 50 MB.");
    try {
      const data = JSON.parse(await f.text()) as StationFile;
      if (data?.format !== "the-last-radio.station" || !data.station) throw new Error();
      setFile(data);
      setSlug(freeSlug(data.station.slug, new Set(radios?.map((r) => r.slug))));
      setName(data.station.name);
    } catch {
      setProblem("That isn't a station file. Use Export on a station's settings page to make one.");
    }
  };

  const importIt = useMutation({
    mutationFn: () =>
      api.post<{ radio: Radio; summary: Summary }>(
        `/radios/import?${new URLSearchParams({ slug, name })}`,
        file,
      ),
    onSuccess: ({ radio, summary }) => {
      const who = summary.people.placeholders
        ? `${plural(summary.people.matched, "person")} matched, ${summary.people.placeholders} without an account here`
        : `${plural(summary.people.matched, "person", "people")} matched`;
      toast.success(`${radio.name} imported`, {
        description: `${plural(summary.plays, "play")}, ${plural(summary.songs, "song")} (${summary.newSongs} new here), ${plural(summary.queued, "song")} lined up. ${who}.`,
      });
      qc.invalidateQueries({ queryKey: ["radios"] });
      onOpenChange(false);
      reset();
      navigate(`/admin/stations/${radio.slug}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    importIt.mutate();
  };

  const aired = file?.plays.filter((p) => p.status !== "queued" && p.status !== "playing").length ?? 0;
  const lined = file ? file.plays.length - aired : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Import a station</DialogTitle>
            <DialogDescription>
              From a file made with Export, here or on another radio. It becomes a new station with its settings, who may
              listen, its queue and its whole history.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="station-file">Station file</Label>
            <Input id="station-file" type="file" accept=".json,application/json" onChange={pick} />
          </div>

          {problem && (
            <Alert variant="destructive">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          )}

          {file && (
            <>
              <div className="rounded-lg bg-muted/40 p-3 text-sm">
                <div className="font-medium">
                  {file.station.name}
                  {file.station.isPrivate && <span className="text-muted-foreground"> · private</span>}
                </div>
                <div className="text-muted-foreground">
                  {plural(aired, "play")} of {plural(file.songs.length, "song")}, {plural(lined, "song")} lined up,{" "}
                  {plural(file.people.length, "person", "people")}, {plural(file.upvotes.length, "upvote")}. Exported{" "}
                  {new Date(file.exportedAt).toLocaleString()}.
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="import-name">Name</Label>
                  <Input id="import-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="import-slug">Address</Label>
                  <Input
                    id="import-slug"
                    required
                    maxLength={40}
                    pattern="[a-z0-9](?:[a-z0-9\-]{0,38}[a-z0-9])?"
                    title="Lowercase letters, digits and dashes"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                People are matched to accounts here by email. Anyone without one keeps their name in the history, on an
                account nobody can sign in to.
              </p>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!file || importIt.isPending}>
              <FileUp /> {importIt.isPending ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

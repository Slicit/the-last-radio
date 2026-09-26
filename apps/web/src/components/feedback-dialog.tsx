import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bug, Lightbulb, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";

type Kind = "idea" | "bug" | "other";
type Mine = {
  items: { id: string; kind: Kind; body: string; createdAt: string; read: boolean; archived: boolean }[];
  allowance: { limit: number; remaining: number; nextAt: string | null };
};

export const KINDS: { value: Kind; label: string; icon: typeof Lightbulb }[] = [
  { value: "idea", label: "Idea", icon: Lightbulb },
  { value: "bug", label: "Bug", icon: Bug },
  { value: "other", label: "Other", icon: MessageSquare },
];
const MAX = 2000;

/** "Send feedback": a short message to the people running the radio, 3 a day. */
export function FeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>("idea");
  const [body, setBody] = useState("");
  const mine = useQuery({
    queryKey: ["feedback", "mine"],
    queryFn: () => api.get<Mine>("/feedback/mine"),
    enabled: open,
  });
  const send = useMutation({
    mutationFn: () => api.post("/feedback", { kind, body }),
    onSuccess: () => {
      toast.success("Thanks! Your feedback was sent.");
      setBody("");
      qc.invalidateQueries({ queryKey: ["feedback", "mine"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const a = mine.data?.allowance;
  const outOfSends = a?.remaining === 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    send.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Send feedback</DialogTitle>
            <DialogDescription>An idea, a bug, a wish: it goes straight to the people running the radio.</DialogDescription>
          </DialogHeader>

          <div className="flex gap-1.5" role="radiogroup" aria-label="Kind of feedback">
            {KINDS.map(({ value, label, icon: Icon }) => (
              <Button
                key={value}
                type="button"
                role="radio"
                aria-checked={kind === value}
                variant={kind === value ? "secondary" : "ghost"}
                onClick={() => setKind(value)}
              >
                <Icon /> {label}
              </Button>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback-body">Your message</Label>
            <Textarea
              id="feedback-body"
              rows={5}
              required
              minLength={10}
              maxLength={MAX}
              disabled={outOfSends}
              placeholder={kind === "bug" ? "What happened, and what did you expect?" : "What would make the radio better?"}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="max-h-64"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {a &&
                  (outOfSends
                    ? `You've sent ${a.limit} today, thank you! More ${a.nextAt ? ago(a.nextAt) : "tomorrow"}.`
                    : `You can send ${a.remaining} more today.`)}
              </span>
              <span className="tabular-nums">
                {body.length}/{MAX}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={send.isPending || outOfSends || body.trim().length < 10}>
              Send
            </Button>
          </DialogFooter>

          {!!mine.data?.items.length && (
            <div className="space-y-2 border-t pt-4">
              <div className="text-sm font-medium">What you've sent</div>
              <ul className="space-y-2">
                {mine.data.items.slice(0, 5).map((f) => (
                  <li key={f.id} className="rounded-md bg-muted/40 p-2.5 text-sm">
                    <div className="line-clamp-2">{f.body}</div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      {ago(f.createdAt)}
                      <Badge variant={f.read ? "secondary" : "outline"}>
                        {f.archived ? "Archived" : f.read ? "Read by the team" : "Not read yet"}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AtSign, TriangleAlert, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type StationAccess } from "@/lib/api";

/** Who may hear a private station: people added by email, and verified email domains. */
export function StationAccessPanel({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const key = ["station-access", slug];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.get<StationAccess>(`/radios/${slug}/access`) });
  const [email, setEmail] = useState("");
  const [domain, setDomain] = useState("");
  const done = (msg: string) => () => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: key });
  };
  const fail = (e: Error) => toast.error(e.message);

  const addMember = useMutation({
    mutationFn: () => api.post(`/radios/${slug}/members`, { email }),
    onSuccess: () => {
      setEmail("");
      done("Added")();
    },
    onError: fail,
  });
  const removeMember = useMutation({ mutationFn: (id: string) => api.del(`/radios/${slug}/members/${id}`), onSuccess: done("Removed"), onError: fail });
  const addDomain = useMutation({
    mutationFn: () => api.post(`/radios/${slug}/domains`, { domain }),
    onSuccess: () => {
      setDomain("");
      done("Domain added")();
    },
    onError: fail,
  });
  const removeDomain = useMutation({ mutationFn: (d: string) => api.del(`/radios/${slug}/domains/${encodeURIComponent(d)}`), onSuccess: done("Domain removed"), onError: fail });

  const submit = (fn: () => void) => (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };

  return (
    <div className="space-y-4 rounded-lg border p-3">
      <div className="space-y-2">
        <Label htmlFor="member-email">People</Label>
        <form onSubmit={submit(() => addMember.mutate())} className="flex gap-2">
          <Input id="member-email" type="email" placeholder="someone@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" variant="outline" disabled={!email || addMember.isPending}>
            <UserPlus /> Add
          </Button>
        </form>
        {data?.members.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {data.members.map((m) => (
              <li key={m.id} className="flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-2.5 text-xs text-secondary-foreground">
                {m.displayName} <span className="text-muted-foreground">({m.email})</span>
                <button type="button" aria-label={`Remove ${m.displayName}`} className="rounded-full p-0.5 hover:bg-background/60" onClick={() => removeMember.mutate(m.id)}>
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No one added yet. They need an account first.</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="member-domain">Email domains</Label>
        <form onSubmit={submit(() => addDomain.mutate())} className="flex gap-2">
          <Input id="member-domain" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
          <Button type="submit" variant="outline" disabled={!domain || addDomain.isPending}>
            <AtSign /> Add
          </Button>
        </form>
        {!!data?.domains.length && (
          <ul className="flex flex-wrap gap-1.5">
            {data.domains.map((d) => (
              <li key={d} className="flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-2.5 text-xs text-secondary-foreground">
                @{d}
                <button type="button" aria-label={`Remove ${d}`} className="rounded-full p-0.5 hover:bg-background/60" onClick={() => removeDomain.mutate(d)}>
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Anyone whose <strong className="text-foreground">confirmed</strong> email ends with one of these domains can listen and add songs.
          Unconfirmed addresses don't count: anyone could type one.
        </p>
        {data && !data.mailConfigured && (
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            Email isn't set up (SMTP_URL), so people can't confirm their address yet. Domains only work for people you mark verified in Users.
          </p>
        )}
      </div>
    </div>
  );
}

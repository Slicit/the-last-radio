import { useState, type KeyboardEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AtSign, TriangleAlert, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type StationAccess } from "@/lib/api";

/** An input plus an Add button. Not a <form>: see StationAccessPanel. */
function AddField({ label, id, icon, busy, onAdd, value, onChange, placeholder, type }: {
  label: string;
  id: string;
  icon: ReactNode;
  busy: boolean;
  onAdd: () => void;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
}) {
  const ready = !!value.trim() && !busy;
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault(); // Enter must not submit (save) the station editor around us
    if (ready) onAdd();
  };
  return (
    <div role="group" aria-label={label} className="flex gap-2">
      <Input id={id} type={type} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} />
      <Button type="button" variant="outline" disabled={!ready} onClick={onAdd}>
        {icon} Add
      </Button>
    </div>
  );
}

const Chip = ({ children, onRemove, removeLabel }: { children: ReactNode; onRemove: () => void; removeLabel: string }) => (
  <span className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-2.5 text-xs text-secondary-foreground">
    {children}
    <button type="button" aria-label={removeLabel} className="rounded-full p-0.5 hover:bg-background/60" onClick={onRemove}>
      <X className="size-3" />
    </button>
  </span>
);

/**
 * Who may hear a private station: people added by email, and verified email
 * domains. It sits inside the station editor's <form>, and forms can't nest,
 * so nothing here is a form: an inner one made "Add" save the station instead.
 */
export function StationAccessPanel({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const key = ["station-access", slug];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.get<StationAccess>(`/radios/${slug}/access`) });
  const [email, setEmail] = useState("");
  const [domain, setDomain] = useState("");
  const done = (msg: string) => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: key });
  };
  const fail = (e: Error) => toast.error(e.message);

  const addMember = useMutation({
    mutationFn: () => api.post(`/radios/${slug}/members`, { email }),
    onSuccess: () => {
      setEmail("");
      done("Added");
    },
    onError: fail,
  });
  const removeMember = useMutation({ mutationFn: (id: string) => api.del(`/radios/${slug}/members/${id}`), onSuccess: () => done("Removed"), onError: fail });
  const addDomain = useMutation({
    mutationFn: () => api.post<{ domain: string }>(`/radios/${slug}/domains`, { domain }),
    onSuccess: (d) => {
      setDomain("");
      done(`@${d.domain} added`);
    },
    onError: fail,
  });
  const removeDomain = useMutation({
    mutationFn: (d: string) => api.del(`/radios/${slug}/domains/${encodeURIComponent(d)}`),
    onSuccess: (_, d) => done(`@${d} removed`),
    onError: fail,
  });
  const vouch = useMutation({
    mutationFn: (id: string) => api.patch(`/users/${id}`, { emailVerified: true }),
    onSuccess: () => {
      done("Marked as confirmed");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: fail,
  });

  return (
    <div className="space-y-4 rounded-lg border p-3">
      <div className="space-y-2">
        <Label htmlFor="member-email">People</Label>
        <AddField
          label="People"
          id="member-email"
          type="email"
          placeholder="someone@example.com"
          value={email}
          onChange={setEmail}
          icon={<UserPlus />}
          busy={addMember.isPending}
          onAdd={() => addMember.mutate()}
        />
        {data?.members.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {data.members.map((m) => (
              <li key={m.id}>
                <Chip removeLabel={`Remove ${m.displayName}`} onRemove={() => removeMember.mutate(m.id)}>
                  {m.displayName} <span className="text-muted-foreground">({m.email})</span>
                </Chip>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No one added yet. They need an account first.</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="member-domain">Email domains</Label>
        <AddField
          label="Email domains"
          id="member-domain"
          placeholder="example.com"
          value={domain}
          onChange={setDomain}
          icon={<AtSign />}
          busy={addDomain.isPending}
          onAdd={() => addDomain.mutate()}
        />
        {!!data?.matches.length && (
          <ul className="space-y-2">
            {data.matches.map(({ domain: d, people }) => {
              const confirmed = people.filter((p) => p.verified).length;
              return (
                <li key={d} className="space-y-1.5 rounded-md bg-muted/40 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip removeLabel={`Remove ${d}`} onRemove={() => removeDomain.mutate(d)}>
                      @{d}
                    </Chip>
                    <span className="text-xs text-muted-foreground">
                      {people.length === 0
                        ? "Nobody at this domain has an account yet: they'll get in once they sign up and confirm."
                        : `${confirmed} of ${people.length} ${people.length === 1 ? "person" : "people"} at this domain ${confirmed === 1 ? "is" : "are"} in`}
                    </span>
                  </div>
                  {people.length > 0 && (
                    <ul className="flex flex-wrap gap-1.5" aria-label={`People at ${d}`}>
                      {people.map((p) => (
                        <li
                          key={p.id}
                          title={p.email}
                          className={
                            p.verified
                              ? "rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground"
                              : "inline-flex items-center gap-1 rounded-full border border-dashed py-0.5 pr-1 pl-2.5 text-xs text-muted-foreground"
                          }
                        >
                          {p.displayName}
                          {!p.verified && (
                            <>
                              <span>· not confirmed</span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                disabled={vouch.isPending}
                                onClick={() => vouch.mutate(p.id)}
                                title="Vouch for this address (when email can't be sent)"
                              >
                                Mark confirmed
                              </Button>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Anyone whose <strong className="text-foreground">confirmed</strong> email ends with one of these domains can listen and add songs,
          including people who sign up later. Unconfirmed addresses don't count: anyone could type one.
        </p>
        {data && !data.mailConfigured && (
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            Email isn't set up (SMTP_URL), so people can't confirm their address themselves. Use "Mark confirmed" for the people you know.
          </p>
        )}
      </div>
    </div>
  );
}

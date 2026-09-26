import { useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, ImageUp, Loader2, Trash2, UserX } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type User } from "@/lib/api";
import { initials } from "@/lib/format";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

/** Edit your name and photo. The server re-checks everything checked here. */
export function ProfileDialog({ user, open, onOpenChange }: { user: User; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(user.displayName);
  const [busy, setBusy] = useState<"photo" | "remove" | "name" | "delete" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const navigate = useNavigate();

  const resend = async () => {
    try {
      await api.post("/me/verify-email");
      toast.success(`Sent! Check ${user.email} for the confirmation link.`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const deleteAccount = async () => {
    setBusy("delete");
    try {
      await api.del_("/me", { password });
      qc.setQueryData(["me"], { user: null });
      qc.clear();
      onOpenChange(false);
      navigate("/");
      toast.success("Your account was deleted. Thanks for listening.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saved = (u: User) => qc.setQueryData(["me"], { user: u });

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) return toast.error("That image is over 5 MB");
    if (!ACCEPT.split(",").includes(file.type)) return toast.error("Use a JPEG, PNG, WebP or GIF image");
    setBusy("photo");
    try {
      const form = new FormData();
      form.append("file", file);
      saved((await api.put<{ user: User }>("/me/avatar", form)).user);
      toast.success("Photo updated");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      saved((await api.del<{ user: User }>("/me/avatar")).user);
    } finally {
      setBusy(null);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("name");
    try {
      saved((await api.patch<{ user: User }>("/me", { displayName: name })).user);
      toast.success("Profile saved");
      onOpenChange(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Your profile</DialogTitle>
            <DialogDescription>This is how other listeners see you next to the songs you add.</DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-4">
            <Avatar className="size-20">
              {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
              <AvatarFallback className="text-xl">{initials(user.displayName)}</AvatarFallback>
            </Avatar>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={!!busy} onClick={() => fileRef.current?.click()}>
                  {busy === "photo" ? <Loader2 className="animate-spin" /> : <ImageUp />}
                  {user.avatarUrl ? "Change photo" : "Upload photo"}
                </Button>
                {user.avatarUrl && (
                  <Button type="button" variant="ghost" disabled={!!busy} onClick={remove}>
                    <Trash2 /> Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">JPEG, PNG, WebP or GIF, up to 5 MB. We crop it to a square.</p>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                aria-label="Profile photo"
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="min-w-0 truncate">
              {user.email}{" "}
              <span className={user.emailVerified ? "text-brand" : "text-muted-foreground"}>
                · {user.emailVerified ? "confirmed" : "not confirmed yet"}
              </span>
            </span>
            {!user.emailVerified && (
              <Button type="button" size="sm" variant="outline" disabled={!!busy} onClick={resend}>
                Send confirmation email
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-name">Display name</Label>
            <Input
              id="profile-name"
              required
              minLength={2}
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-2 border-t pt-4">
            <div className="text-sm font-medium">Your data</div>
            <p className="text-xs text-muted-foreground">
              What the radio keeps and why is in the{" "}
              <Link to="/privacy" className="text-foreground underline" onClick={() => onOpenChange(false)}>
                privacy notice
              </Link>
              .
            </p>
            <div className="flex flex-wrap gap-2">
              <a href="/api/me/export" download className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm hover:bg-muted">
                <Download className="size-4" /> Download my data
              </a>
              {!deleting && (
                <Button type="button" variant="destructive" onClick={() => setDeleting(true)}>
                  <UserX /> Delete my account
                </Button>
              )}
            </div>
            {deleting && (
              <div className="space-y-2 rounded-lg border border-destructive/40 p-3">
                <p className="text-sm">
                  This erases your email, password, photo, sessions, API keys and feedback. Songs you added stay in the
                  stations' history as "Former listener". It can't be undone.
                </p>
                <Label htmlFor="delete-password">Confirm with your password</Label>
                <Input
                  id="delete-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={() => setDeleting(false)}>
                    Keep my account
                  </Button>
                  <Button type="button" variant="destructive" disabled={!password || busy === "delete"} onClick={deleteAccount}>
                    Delete for good
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" disabled={!!busy || name.trim() === user.displayName || name.trim().length < 2}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

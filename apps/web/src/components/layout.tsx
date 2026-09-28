import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useAckPrivacy } from "@/components/privacy-ack";
import { Bot, LogOut, MailWarning, MessageSquare, Palette, Radio as RadioIcon, Shield, UserPen, X } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { ProfileDialog } from "@/components/profile-dialog";
import { useSiteSettings, useTheme } from "@/hooks/use-theme";
import { api, type Theme } from "@/lib/api";
import { useState } from "react";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlayerBar } from "@/components/player-bar";
import { useAuthActions, useMe } from "@/hooks/use-auth";
import { usePlayer } from "@/hooks/use-player";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "rounded-md px-2.5 py-1.5 text-sm transition-colors hover:text-foreground",
    isActive ? "text-foreground" : "text-muted-foreground",
  );

/** For people already signed in when the notice changes: a nudge, never a wall. */
function PrivacyBanner() {
  const ack = useAckPrivacy();
  return (
    <div className="border-b bg-muted/60">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
        <span>Our privacy &amp; cookies notice was updated.</span>
        <Link to="/privacy" className="underline">
          Read it
        </Link>
        <button type="button" className="ml-auto font-medium underline-offset-4 hover:underline" onClick={() => ack()}>
          Got it
        </button>
      </div>
    </div>
  );
}

/** Signed in but the address isn't confirmed: say why it matters, and send the link. */
function ConfirmEmailBanner({ email }: { email: string }) {
  const [hidden, setHidden] = useState(false); // until the next page load, on purpose: nothing stored
  const [sent, setSent] = useState(false);
  const send = useMutation({
    mutationFn: () => api.post("/me/verify-email"),
    onSuccess: () => setSent(true),
    onError: (e) => toast.error(e.message),
  });
  if (hidden) return null;
  return (
    <div role="region" aria-label="Confirm your email" className="border-b bg-amber-100 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm">
        <MailWarning className="size-4 shrink-0" />
        {sent ? (
          <span>
            Sent! Open the link we emailed to <strong>{email}</strong> (check your spam folder too).
          </span>
        ) : (
          <span>
            Confirm your email, <strong>{email}</strong>, to join the private stations your email domain opens.
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {!sent && (
            <Button size="sm" variant="outline" className="h-7 bg-transparent" disabled={send.isPending} onClick={() => send.mutate()}>
              {send.isPending ? "Sending…" : "Send confirmation email"}
            </Button>
          )}
          <button type="button" aria-label="Hide" className="rounded p-1 opacity-70 hover:opacity-100" onClick={() => setHidden(true)}>
            <X className="size-4" />
          </button>
        </span>
      </div>
    </div>
  );
}

export function Layout() {
  const { user } = useMe();
  const { logout } = useAuthActions();
  const { station } = usePlayer();
  const navigate = useNavigate();
  const location = useLocation();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const site = useSiteSettings();

  return (
    <div className={cn("min-h-svh", station && "pb-20")}>
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <RadioIcon className="size-5 text-brand" />
            The Last Radio
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={navClass}>
              Radios
            </NavLink>
            {user?.role === "admin" && (
              <NavLink to="/admin" className={navClass}>
                Admin
              </NavLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="hidden text-sm sm:inline">{user.displayName}</span>
                  <Avatar size="sm">
                    {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                    <AvatarFallback>{initials(user.displayName)}</AvatarFallback>
                  </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="flex items-center justify-between gap-2">
                      <span className="truncate">{user.email}</span>
                      <Badge variant={user.role === "admin" ? "default" : "secondary"}>{user.role}</Badge>
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setProfileOpen(true)}>
                    <UserPen /> Edit profile
                  </DropdownMenuItem>
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                      <Palette className="size-3.5" /> Theme
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
                      <DropdownMenuRadioItem value="night">Night</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="vintage">Vintage</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/connect")}>
                    <Bot /> Connect your AI
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setFeedbackOpen(true)}>
                    <MessageSquare /> Send feedback
                  </DropdownMenuItem>
                  {user.role === "admin" && (
                    <DropdownMenuItem onClick={() => navigate("/admin")}>
                      <Shield /> Admin
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    onClick={() => logout.mutate(undefined, { onSuccess: () => navigate("/") })}
                  >
                    <LogOut /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <Link to="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  Sign in
                </Link>
                <Link to="/register" className={buttonVariants({ size: "sm" })}>
                  Join
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      {user?.privacyAckRequired && location.pathname !== "/login" && location.pathname !== "/privacy" && (
        <PrivacyBanner />
      )}
      {user && !user.emailVerified && site.data?.emailEnabled && location.pathname !== "/verify-email" && (
        <ConfirmEmailBanner email={user.email} />
      )}
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-8 text-xs text-muted-foreground">
        <span>The Last Radio</span>
        <Link to="/privacy" className="hover:text-foreground hover:underline">
          Privacy &amp; cookies
        </Link>
        <Link to="/developers" className="hover:text-foreground hover:underline">
          Developers &amp; API
        </Link>
        <span>One sign-in cookie, no trackers.</span>
      </footer>
      <PlayerBar />
      {user && <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />}
      {user && profileOpen && <ProfileDialog user={user} open={profileOpen} onOpenChange={setProfileOpen} />}
    </div>
  );
}

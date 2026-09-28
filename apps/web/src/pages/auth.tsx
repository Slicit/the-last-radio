import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuthActions, useMe } from "@/hooks/use-auth";
import { PrivacyAck } from "@/components/privacy-ack";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { user } = useMe();
  const { login, register } = useAuthActions();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [accepted, setAccepted] = useState(false);

  const m = mode === "login" ? login : register;
  // Signed in, but the privacy notice is new to them: a quick step before going on.
  if (user?.privacyAckRequired) return <PrivacyAck onDone={() => navigate(from, { replace: true })} />;
  if (user) return <Navigate to={from} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    // If the privacy notice is new to them, stay here: the page shows the acknowledgement step.
    const done = { onSuccess: (d: { user: { privacyAckRequired: boolean } }) => !d.user.privacyAckRequired && navigate(from, { replace: true }) };
    if (mode === "login") login.mutate({ email, password }, done);
    else register.mutate({ email, password, displayName, acceptPrivacy: accepted }, done);
  };

  return (
    <div className="mx-auto max-w-sm pt-8">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{mode === "login" ? "Welcome back" : "Join the radio"}</CardTitle>
          <CardDescription>
            {mode === "login" ? "Sign in to add songs." : "Create an account to add songs to the stations."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && (
              <div className="space-y-2">
                <Label htmlFor="displayName">Display name</Label>
                <Input
                  id="displayName"
                  required
                  minLength={2}
                  maxLength={40}
                  autoComplete="nickname"
                  aria-describedby="displayName-hint"
                  placeholder="e.g. DJ Nightowl"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
                <p id="displayName-hint" className="text-xs text-muted-foreground">
                  A nickname is fine: it's what others see next to your songs, not necessarily your real name.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={mode === "register" ? 8 : 1}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {mode === "register" && (
              <label className="flex items-start gap-2.5 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  required
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  I've read the{" "}
                  <Link to="/privacy" target="_blank" className="text-foreground underline">
                    privacy &amp; cookies notice
                  </Link>
                  . The radio uses one sign-in cookie and no trackers.
                </span>
              </label>
            )}
            {m.error && (
              <Alert variant="destructive">
                <AlertDescription>{m.error.message}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={m.isPending}>
              {m.isPending ? "…" : mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <>
                New here?{" "}
                <Link to="/register" state={location.state} className="text-foreground underline">
                  Create an account
                </Link>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <Link to="/login" state={location.state} className="text-foreground underline">
                  Sign in
                </Link>
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

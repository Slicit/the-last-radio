import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type User } from "@/lib/api";
import { POLICY_VERSION } from "@/pages/privacy";

/** Records that the user read the current privacy notice. */
export function useAckPrivacy() {
  const qc = useQueryClient();
  return async () => {
    const { user } = await api.post<{ user: User }>("/me/privacy-ack", { version: POLICY_VERSION });
    qc.setQueryData(["me"], { user });
  };
}

/** The inline step after signing in when the notice is new to someone. Not a modal. */
export function PrivacyAck({ onDone }: { onDone: () => void }) {
  const ack = useAckPrivacy();
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto max-w-md pt-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <ShieldCheck className="size-5 text-brand" /> Before you continue
          </CardTitle>
          <CardDescription>
            Our privacy &amp; cookies notice is new to you, or changed since your last visit. In short: one sign-in
            cookie, no trackers, no ads, and your data is yours to download or delete anytime.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link to="/privacy" target="_blank" className="inline-flex h-9 items-center rounded-lg border px-3 text-sm hover:bg-muted">
            Read the notice
          </Link>
          <Button
            size="lg"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await ack();
                onDone();
              } finally {
                setBusy(false);
              }
            }}
          >
            I've read it, continue
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

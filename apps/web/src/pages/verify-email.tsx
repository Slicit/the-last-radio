import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

/** Where the link in the confirmation email lands. */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [error, setError] = useState("");

  useEffect(() => {
    const token = params.get("token") ?? "";
    api
      .post("/auth/verify-email", { token })
      .then(() => {
        setState("done");
        qc.invalidateQueries({ queryKey: ["me"] });
        qc.invalidateQueries({ queryKey: ["radios"] });
      })
      .catch((e) => {
        setError((e as Error).message);
        setState("failed");
      });
  }, [params, qc]);

  return (
    <div className="mx-auto max-w-md pt-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            {state === "working" && <Loader2 className="size-5 animate-spin" />}
            {state === "done" && <CheckCircle2 className="size-5 text-brand" />}
            {state === "failed" && <XCircle className="size-5 text-destructive" />}
            {state === "working" ? "Confirming your email…" : state === "done" ? "Email confirmed" : "That link didn't work"}
          </CardTitle>
          <CardDescription>
            {state === "done"
              ? "Thanks! Private stations open to your email's domain are now yours to join."
              : state === "failed"
                ? error
                : ""}
          </CardDescription>
        </CardHeader>
        {state !== "working" && (
          <CardContent>
            <Link to="/" className="text-sm underline">
              Back to the stations
            </Link>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

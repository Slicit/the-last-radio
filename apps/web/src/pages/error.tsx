import { isRouteErrorResponse, useRouteError } from "react-router";
import { buttonVariants } from "@/components/ui/button";

export function ErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "Unknown error";
  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold">Static on the line</h1>
      <p className="text-sm text-muted-foreground">Something broke while rendering this page.</p>
      <pre className="w-full overflow-x-auto rounded-md bg-muted p-3 text-left text-xs">{message}</pre>
      <a href="/" className={buttonVariants()}>
        Back to the stations
      </a>
    </div>
  );
}

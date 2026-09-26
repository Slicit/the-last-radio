import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PlayerProvider } from "@/hooks/use-player";
import { Layout } from "@/components/layout";
import { HomePage } from "@/pages/home";
import { RadioPage } from "@/pages/radio";
import { AuthPage } from "@/pages/auth";
import { AdminPage } from "@/pages/admin";
import { ErrorPage } from "@/pages/error";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, err) => n < 2 && !(err as { status?: number }).status, refetchOnWindowFocus: true },
  },
});

const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/r/:slug", element: <RadioPage /> },
      { path: "/login", element: <AuthPage mode="login" /> },
      { path: "/register", element: <AuthPage mode="register" /> },
      { path: "/admin", element: <AdminPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PlayerProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster position="top-center" theme="dark" />
        </TooltipProvider>
      </PlayerProvider>
    </QueryClientProvider>
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PlayerProvider } from "@/hooks/use-player";
import { useTheme } from "@/hooks/use-theme";
import { Layout } from "@/components/layout";
import { HomePage } from "@/pages/home";
import { RadioPage } from "@/pages/radio";
import { AuthPage } from "@/pages/auth";
import { AdminFeedbackPage, AdminLayout, AdminOverviewPage, AdminSettingsPage, AdminStationsPage, AdminUsersPage } from "@/pages/admin";
import { ErrorPage } from "@/pages/error";
import { ConnectPage } from "@/pages/connect";
import { OAuthAuthorizePage } from "@/pages/oauth-authorize";
import { PrivacyPage } from "@/pages/privacy";
import { VerifyEmailPage } from "@/pages/verify-email";
import { DevelopersPage } from "@/pages/developers";
import { StationEditorPage } from "@/pages/station-editor";
import "./index.css";

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster position="top-center" theme={theme === "night" ? "dark" : "light"} />;
}

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
      {
        path: "/admin",
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminOverviewPage /> },
          { path: "feedback", element: <AdminFeedbackPage /> },
          { path: "stations", element: <AdminStationsPage /> },
          { path: "stations/new", element: <StationEditorPage /> },
          { path: "stations/:slug", element: <StationEditorPage /> },
          { path: "users", element: <AdminUsersPage /> },
          { path: "settings", element: <AdminSettingsPage /> },
        ],
      },
      { path: "/connect", element: <ConnectPage /> },
      { path: "/oauth/authorize", element: <OAuthAuthorizePage /> },
      { path: "/privacy", element: <PrivacyPage /> },
      { path: "/privacy/:lang", element: <PrivacyPage /> },
      { path: "/verify-email", element: <VerifyEmailPage /> },
      { path: "/developers", element: <DevelopersPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PlayerProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
          <ThemedToaster />
        </TooltipProvider>
      </PlayerProvider>
    </QueryClientProvider>
  </StrictMode>,
);

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type User } from "@/lib/api";

export function useMe() {
  const q = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ user: User | null }>("/auth/me"),
    staleTime: 60_000,
  });
  return { user: q.data?.user ?? null, isLoading: q.isLoading };
}

export function useAuthActions() {
  const qc = useQueryClient();
  const onAuthed = (data: { user: User | null }) => {
    qc.setQueryData(["me"], data);
    // Quotas and admin-only fields depend on who is signed in.
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
  };
  return {
    login: useMutation({
      mutationFn: (body: { email: string; password: string }) =>
        api.post<{ user: User }>("/auth/login", body),
      onSuccess: onAuthed,
    }),
    register: useMutation({
      mutationFn: (body: { email: string; password: string; displayName: string }) =>
        api.post<{ user: User }>("/auth/register", body),
      onSuccess: onAuthed,
    }),
    logout: useMutation({
      mutationFn: () => api.post("/auth/logout"),
      onSuccess: () => onAuthed({ user: null }),
    }),
  };
}

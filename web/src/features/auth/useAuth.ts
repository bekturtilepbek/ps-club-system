import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const AUTH_QUERY_KEY = ["auth", "me"] as const;

export function useAuth() {
  const queryClient = useQueryClient();

  const meQuery = useQuery({ queryKey: AUTH_QUERY_KEY, queryFn: api.me, retry: false });

  const loginMutation = useMutation({
    mutationFn: (password: string) => api.login(password),
    onSuccess: (data) => queryClient.setQueryData(AUTH_QUERY_KEY, data),
  });

  const logoutMutation = useMutation({
    mutationFn: api.logout,
    onSuccess: (data) => queryClient.setQueryData(AUTH_QUERY_KEY, data),
  });

  return {
    isAuthenticated: meQuery.data?.authenticated ?? false,
    isLoading: meQuery.isLoading,
    login: loginMutation.mutateAsync,
    loginError: loginMutation.error,
    logout: logoutMutation.mutateAsync,
  };
}

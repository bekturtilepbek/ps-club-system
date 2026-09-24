import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

export function useSessionActions() {
  const queryClient = useQueryClient();
  const invalidateHall = () => queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY });

  const stopMutation = useMutation({ mutationFn: api.stopSession, onSuccess: invalidateHall });
  const cancelMutation = useMutation({ mutationFn: api.cancelSession, onSuccess: invalidateHall });

  return {
    stop: stopMutation.mutateAsync,
    cancel: cancelMutation.mutateAsync,
    stopping: stopMutation.isPending,
    cancelling: cancelMutation.isPending,
  };
}

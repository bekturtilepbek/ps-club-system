import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { formatSom } from "@/lib/format";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

interface ExtendSessionDialogProps {
  open: boolean;
  sessionId: number;
  onOpenChange: (open: boolean) => void;
  onExtended: () => void;
}

export function ExtendSessionDialog({ open, sessionId, onOpenChange, onExtended }: ExtendSessionDialogProps) {
  const tariffsQuery = useQuery({ queryKey: ["tariffs"], queryFn: api.tariffs, enabled: open });
  const [tariffId, setTariffId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const extendMutation = useMutation({
    mutationFn: () => api.extendSession(sessionId, tariffId as number),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY });
      onExtended();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Продлить сессию</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-1">
          {(tariffsQuery.data ?? []).map((tariff) => (
            <button
              key={tariff.id}
              type="button"
              className={"rounded border p-2 text-left" + (tariffId === tariff.id ? " border-primary" : "")}
              onClick={() => setTariffId(tariff.id)}
            >
              {tariff.name} — {formatSom(tariff.kind === "package" ? (tariff.price ?? 0) : (tariff.hourly_rate ?? 0))}
              {tariff.kind === "open" ? "/час" : ""}
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button onClick={() => extendMutation.mutate()} disabled={tariffId === null || extendMutation.isPending}>
            Продлить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

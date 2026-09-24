import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { formatSom } from "@/lib/format";
import { serverNow } from "@/lib/clock";
import { HALL_QUERY_KEY } from "./useHallSnapshot";
import { packageEndsAfterPlannedClose } from "./plannedClose";

interface ExtendSessionDialogProps {
  open: boolean;
  sessionId: number;
  onOpenChange: (open: boolean) => void;
  onExtended: () => void;
}

export function ExtendSessionDialog({ open, sessionId, onOpenChange, onExtended }: ExtendSessionDialogProps) {
  const tariffsQuery = useQuery({ queryKey: ["tariffs"], queryFn: api.tariffs, enabled: open });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings, enabled: open });
  const [tariffId, setTariffId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const selectedTariff = (tariffsQuery.data ?? []).find((t) => t.id === tariffId);
  const plannedClose = settingsQuery.data?.planned_close;
  const showsLateWarning =
    selectedTariff?.kind === "package" &&
    selectedTariff.duration_min != null &&
    plannedClose !== undefined &&
    packageEndsAfterPlannedClose(serverNow(), selectedTariff.duration_min, plannedClose);

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

        {showsLateWarning && (
          <p className="text-sm text-amber-600">
            Пакет закончится после планового закрытия ({plannedClose}). Решение — за администратором.
          </p>
        )}

        {extendMutation.isError && (
          <p className="text-sm text-red-600">Не удалось продлить сессию. Попробуйте ещё раз.</p>
        )}

        <DialogFooter>
          <Button onClick={() => extendMutation.mutate()} disabled={tariffId === null || extendMutation.isPending}>
            Продлить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

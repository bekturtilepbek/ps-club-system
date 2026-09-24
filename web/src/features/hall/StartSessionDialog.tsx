import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type SessionKind } from "@/lib/api";
import { formatSom } from "@/lib/format";
import { serverNow } from "@/lib/clock";
import { HALL_QUERY_KEY } from "./useHallSnapshot";
import { packageEndsAfterPlannedClose } from "./plannedClose";

interface StartSessionDialogProps {
  open: boolean;
  consoleId: number;
  onOpenChange: (open: boolean) => void;
  onStarted: () => void;
}

export function StartSessionDialog({ open, consoleId, onOpenChange, onStarted }: StartSessionDialogProps) {
  const tariffsQuery = useQuery({ queryKey: ["tariffs"], queryFn: api.tariffs, enabled: open });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings, enabled: open });
  const [kind, setKind] = useState<SessionKind>("paid");
  const [tariffId, setTariffId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();

  const selectedTariff = (tariffsQuery.data ?? []).find((t) => t.id === tariffId);
  const graceMinutes = settingsQuery.data?.grace_minutes ?? 3;
  const plannedClose = settingsQuery.data?.planned_close;
  const showsLateWarning =
    kind === "paid" &&
    selectedTariff?.kind === "package" &&
    selectedTariff.duration_min != null &&
    plannedClose !== undefined &&
    packageEndsAfterPlannedClose(
      serverNow() + graceMinutes * 60_000,
      selectedTariff.duration_min,
      plannedClose,
    );

  const startMutation = useMutation({
    mutationFn: () =>
      api.startSession({
        console_id: consoleId,
        kind,
        tariff_id: kind === "paid" ? tariffId : null,
        reason: kind === "free" ? reason : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY });
      onStarted();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Начать сессию</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Button variant={kind === "paid" ? "default" : "outline"} size="sm" onClick={() => setKind("paid")}>
              Платная
            </Button>
            <Button variant={kind === "free" ? "default" : "outline"} size="sm" onClick={() => setKind("free")}>
              Бесплатная
            </Button>
            <Button variant={kind === "service" ? "default" : "outline"} size="sm" onClick={() => setKind("service")}>
              Служебная
            </Button>
          </div>

          {kind === "paid" && (
            <div className="flex flex-col gap-1">
              <Label>Тариф</Label>
              {(tariffsQuery.data ?? []).map((tariff) => (
                <button
                  key={tariff.id}
                  type="button"
                  className={
                    "rounded border p-2 text-left" + (tariffId === tariff.id ? " border-primary" : "")
                  }
                  onClick={() => setTariffId(tariff.id)}
                >
                  {tariff.name} — {formatSom(tariff.kind === "package" ? (tariff.price ?? 0) : (tariff.hourly_rate ?? 0))}
                  {tariff.kind === "open" ? "/час" : ""}
                </button>
              ))}
            </div>
          )}

          {kind === "free" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="reason">Причина</Label>
              <Input id="reason" value={reason} onChange={(event) => setReason(event.target.value)} />
            </div>
          )}
        </div>

        {showsLateWarning && (
          <p className="text-sm text-amber-600">
            Пакет закончится после планового закрытия ({plannedClose}). Решение — за администратором.
          </p>
        )}

        {startMutation.isError && (
          <p className="text-sm text-red-600">Не удалось начать сессию. Попробуйте ещё раз.</p>
        )}

        <DialogFooter>
          <Button
            onClick={() => startMutation.mutate()}
            disabled={
              startMutation.isPending ||
              (kind === "paid" && tariffId === null) ||
              (kind === "free" && reason.trim().length === 0)
            }
          >
            Начать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StateChip } from "@/components/ui/state-chip";
import type { Tone } from "@/components/ui/tone";
import { api, type SessionKind, type TariffResponse } from "@/lib/api";
import { formatClock } from "@/lib/bishkek";
import { formatSom, pluralRu } from "@/lib/format";
import { LatePackageWarning } from "./LatePackageWarning";
import { TariffTile } from "./TariffTile";
import { packageEndsAfterPlannedClose } from "./plannedClose";
import { useNow } from "./useNow";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

interface StartSessionDialogProps {
  open: boolean;
  consoleId: number;
  consoleName: string;
  onOpenChange: (open: boolean) => void;
  onStarted: () => void;
}

const REASONS = ["Друзья владельца", "Компенсация"];

export function StartSessionDialog({ open, consoleId, consoleName, onOpenChange, onStarted }: StartSessionDialogProps) {
  const tariffsQuery = useQuery({ queryKey: ["tariffs"], queryFn: api.tariffs, enabled: open });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings, enabled: open });
  const [kind, setKind] = useState<SessionKind>("paid");
  const [tariffId, setTariffId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();

  const tariffs = tariffsQuery.data ?? [];
  const selectedTariff = tariffs.find((t) => t.id === tariffId);
  const graceMinutes = settingsQuery.data?.grace_minutes ?? 3;
  const plannedClose = settingsQuery.data?.planned_close;
  const packageStartMs = useNow(open) + graceMinutes * 60_000;

  const endsAt = (tariff: TariffResponse) =>
    tariff.kind === "package" && tariff.duration_min != null ? packageStartMs + tariff.duration_min * 60_000 : null;
  const isLate = (tariff: TariffResponse) =>
    tariff.kind === "package" &&
    tariff.duration_min != null &&
    plannedClose !== undefined &&
    packageEndsAfterPlannedClose(packageStartMs, tariff.duration_min, plannedClose);
  const endsLabel = (tariff: TariffResponse) => {
    const end = endsAt(tariff);
    if (end === null) return "оплата при уходе";
    return `до ${formatClock(end)}${isLate(tariff) ? " · после закрытия" : ""}`;
  };

  const showsLateWarning = kind === "paid" && selectedTariff !== undefined && isLate(selectedTariff);
  const buttonTone: Tone =
    kind === "free" ? "square" : kind === "service" ? "muted" : selectedTariff?.kind === "open" ? "triangle" : "cross";
  const priceSuffix =
    kind === "paid" && selectedTariff?.kind === "package" && selectedTariff.price != null
      ? ` · ${formatSom(selectedTariff.price)}`
      : "";

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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent tone="idle">
        <SheetHeader>
          <SheetTitle>{consoleName}</SheetTitle>
          <StateChip tone="idle">Свободна</StateChip>
        </SheetHeader>
        <SheetBody>
          <div>
            <span className="field-label">Тип сессии</span>
            <SegmentedControl
              ariaLabel="Тип сессии"
              value={kind}
              onChange={setKind}
              options={[
                { value: "paid", label: "Платная" },
                {
                  value: "free",
                  label: (
                    <>
                      <span aria-hidden className="text-xs font-bold text-status-square">□</span>
                      Бесплатная
                    </>
                  ),
                },
                { value: "service", label: "Служебная" },
              ]}
            />
          </div>

          {kind === "paid" && (
            <>
              <div>
                <span className="field-label">Тариф</span>
                <div className="grid grid-cols-2 gap-2.5">
                  {tariffs.map((tariff) => (
                    <TariffTile
                      key={tariff.id}
                      tariff={tariff}
                      selected={tariffId === tariff.id}
                      onSelect={() => setTariffId(tariff.id)}
                      endsLabel={endsLabel(tariff)}
                      late={isLate(tariff)}
                    />
                  ))}
                </div>
              </div>
              {showsLateWarning && plannedClose && selectedTariff && (
                <LatePackageWarning endsAtMs={endsAt(selectedTariff)!} plannedClose={plannedClose} />
              )}
              <p className="note">
                Первые {graceMinutes} {pluralRu(graceMinutes, ["минута", "минуты", "минут"])} — на выбор игры. Если гости
                уйдут за это время, сессию можно отменить без оплаты.
              </p>
            </>
          )}

          {kind === "free" && (
            <div>
              <label htmlFor="reason" className="field-label">
                Причина
              </label>
              <Input id="reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Например: друзья владельца" />
              <div className="mt-2 flex flex-wrap gap-2">
                {REASONS.map((text) => (
                  <button
                    key={text}
                    type="button"
                    onClick={() => setReason(text)}
                    className="h-10 rounded-full border border-line px-3 text-[13px] text-fg-muted hover:border-hover-line hover:text-fg"
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          )}

          {kind === "service" && (
            <p className="note">Обновления, проверка геймпадов, ТВ для себя. Денег нет, в загрузку зала не попадает.</p>
          )}

          {startMutation.isError && (
            <p role="alert" className="text-sm text-status-circle">
              Не удалось начать сессию. Попробуйте ещё раз.
            </p>
          )}
        </SheetBody>
        <SheetFooter>
          <Button
            variant="state"
            size="lg"
            data-tone={buttonTone}
            onClick={() => startMutation.mutate()}
            disabled={
              startMutation.isPending ||
              (kind === "paid" && tariffId === null) ||
              (kind === "free" && reason.trim().length === 0)
            }
          >
            Начать на {consoleName}
            {priceSuffix}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

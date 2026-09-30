import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StateChip } from "@/components/ui/state-chip";
import { api, type SegmentResponse, type TariffResponse } from "@/lib/api";
import { formatClock } from "@/lib/bishkek";
import { serverNow } from "@/lib/clock";
import { LatePackageWarning } from "./LatePackageWarning";
import { TariffTile } from "./TariffTile";
import { estimateExtendStartMs, packageEndsAfterPlannedClose } from "./plannedClose";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

interface ExtendSessionDialogProps {
  open: boolean;
  sessionId: number;
  consoleName: string;
  segments: SegmentResponse[];
  onOpenChange: (open: boolean) => void;
  onExtended: () => void;
}

export function ExtendSessionDialog({ open, sessionId, consoleName, segments, onOpenChange, onExtended }: ExtendSessionDialogProps) {
  const tariffsQuery = useQuery({ queryKey: ["tariffs"], queryFn: api.tariffs, enabled: open });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings, enabled: open });
  const [tariffId, setTariffId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const tariffs = tariffsQuery.data ?? [];
  const selectedTariff = tariffs.find((t) => t.id === tariffId);
  const plannedClose = settingsQuery.data?.planned_close;
  // Open time queued behind a running package starts at the package's end (CLAUDE.md rule 3).
  const startMs = estimateExtendStartMs(serverNow(), segments[segments.length - 1]);

  const isLate = (tariff: TariffResponse) =>
    tariff.kind === "package" &&
    tariff.duration_min != null &&
    plannedClose !== undefined &&
    packageEndsAfterPlannedClose(startMs, tariff.duration_min, plannedClose);
  const endsLabel = (tariff: TariffResponse) =>
    tariff.kind === "package" && tariff.duration_min != null
      ? `до ${formatClock(startMs + tariff.duration_min * 60_000)}${isLate(tariff) ? " · после закрытия" : ""}`
      : `с ${formatClock(startMs)}, поминутно`;

  const extendMutation = useMutation({
    mutationFn: () => api.extendSession(sessionId, tariffId as number),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY });
      onExtended();
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent tone="cross">
        <SheetHeader>
          <SheetTitle>{consoleName}</SheetTitle>
          <StateChip tone="cross">Продление</StateChip>
        </SheetHeader>
        <SheetBody>
          <div>
            <span className="field-label">Продлить на</span>
            <div className="grid grid-cols-2 gap-2.5">
              {tariffs.map((tariff) => (
                <TariffTile
                  key={tariff.id}
                  tariff={tariff}
                  prefix={tariff.kind === "package" ? "+" : ""}
                  selected={tariffId === tariff.id}
                  onSelect={() => setTariffId(tariff.id)}
                  endsLabel={endsLabel(tariff)}
                  late={isLate(tariff)}
                />
              ))}
            </div>
          </div>
          {selectedTariff && isLate(selectedTariff) && plannedClose && (
            <LatePackageWarning endsAtMs={startMs + (selectedTariff.duration_min ?? 0) * 60_000} plannedClose={plannedClose} />
          )}
          {extendMutation.isError && (
            <p role="alert" className="text-sm text-status-circle">
              Не удалось продлить сессию. Попробуйте ещё раз.
            </p>
          )}
        </SheetBody>
        <SheetFooter>
          <Button
            variant="state"
            size="lg"
            data-tone={selectedTariff?.kind === "open" ? "triangle" : "cross"}
            onClick={() => extendMutation.mutate()}
            disabled={tariffId === null || extendMutation.isPending}
          >
            Продлить
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

import { type ReactNode, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

interface BusinessDayGuardProps {
  businessDayOpen: boolean;
  children: ReactNode;
}

export function BusinessDayGuard({ businessDayOpen, children }: BusinessDayGuardProps) {
  const [openingCash, setOpeningCash] = useState("");
  const queryClient = useQueryClient();

  const openMutation = useMutation({
    mutationFn: () => api.openBusinessDay(Number(openingCash)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY }),
  });

  if (businessDayOpen) return <>{children}</>;

  const openingCashValue = Number(openingCash);
  const isValidOpeningCash =
    openingCash.trim().length > 0 && Number.isFinite(openingCashValue) && openingCashValue >= 0;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="flex w-full max-w-sm flex-col gap-4 p-6">
        <h1 className="text-lg font-semibold">День не открыт. Открыть?</h1>
        <div className="flex flex-col gap-1">
          <Label htmlFor="opening-cash">Наличные на начало</Label>
          <Input
            id="opening-cash"
            type="number"
            min="0"
            value={openingCash}
            onChange={(event) => setOpeningCash(event.target.value)}
          />
        </div>
        <Button
          onClick={() => openMutation.mutate()}
          disabled={!isValidOpeningCash || openMutation.isPending}
        >
          Открыть
        </Button>
        {openMutation.isError && (
          <p className="text-sm text-red-600">Не удалось открыть день. Попробуйте ещё раз.</p>
        )}
      </Card>
    </div>
  );
}

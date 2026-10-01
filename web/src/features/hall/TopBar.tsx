import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ThemeSwitch } from "@/features/theme/ThemeSwitch";
import { api } from "@/lib/api";
import { formatClock } from "@/lib/bishkek";
import { formatHoursMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Till } from "./Till";

interface TopBarProps {
  businessDayOpen: boolean;
  businessDayId: number | null;
  nowMs: number;
  onCloseDay: () => void;
  onLogout: () => void;
}

export function TopBar({ businessDayOpen, businessDayId, nowMs, onCloseDay, onLogout }: TopBarProps) {
  const dayQuery = useQuery({
    queryKey: ["business-day", "current"],
    queryFn: api.currentBusinessDay,
    enabled: businessDayOpen,
  });
  const openedAt = typeof dayQuery.data?.opened_at === "string" ? Date.parse(dayQuery.data.opened_at) : null;

  let dayLine = "День не открыт";
  if (businessDayOpen) {
    dayLine = openedAt
      ? `День открыт с ${formatClock(openedAt)} · идёт ${formatHoursMinutes(Math.max(0, Math.floor((nowMs - openedAt) / 60_000)))}`
      : "День открыт";
  }

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center gap-x-5 gap-y-2.5 border-b border-line bg-bg/90 px-4 py-2.5 backdrop-blur short:py-2 sm:px-6">
      <div className="grid gap-0.5">
        <div className="font-display text-base font-extrabold tracking-wide">
          PS<span className="font-medium text-fg-muted">-клуб</span>
        </div>
        <div className="flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-fg-muted">
          <span
            aria-hidden
            className={cn(
              "h-[7px] w-[7px] rounded-full",
              businessDayOpen ? "bg-status-triangle shadow-[0_0_8px_hsl(var(--triangle))]" : "bg-status-idle",
            )}
          />
          {dayLine}
        </div>
      </div>
      {businessDayOpen && businessDayId !== null && <Till businessDayId={businessDayId} />}
      <div className="hidden flex-1 sm:block" />
      <div className="whitespace-nowrap font-display text-[26px] font-extrabold tracking-tight">
        {formatClock(nowMs)}
        <small className="ml-1.5 font-sans text-[11px] font-normal tracking-normal text-fg-muted">Бишкек</small>
      </div>
      <ThemeSwitch />
      {businessDayOpen && (
        <Button variant="outline" onClick={onCloseDay}>
          Закрыть день
        </Button>
      )}
      <Button variant="ghost" onClick={onLogout}>
        Выйти
      </Button>
    </header>
  );
}

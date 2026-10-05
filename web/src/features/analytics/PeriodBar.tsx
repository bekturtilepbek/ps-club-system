import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import type { DateRange, Group, PeriodPreset } from "./periods";

const PRESETS: { value: Exclude<PeriodPreset, "custom">; label: string }[] = [
  { value: "last7", label: "7 дней" },
  { value: "last30", label: "30 дней" },
  { value: "thisMonth", label: "Этот месяц" },
  { value: "prevMonth", label: "Прошлый месяц" },
  { value: "all", label: "Всё время" },
];

interface PeriodBarProps {
  preset: PeriodPreset;
  onPreset: (preset: PeriodPreset) => void;
  custom: DateRange;
  onCustom: (range: DateRange) => void;
  group: Group;
  onGroup: (group: Group) => void;
}

export function PeriodBar({ preset, onPreset, custom, onCustom, group, onGroup }: PeriodBarProps) {
  function changeDate(field: keyof DateRange, value: string) {
    if (!value) return;
    onCustom({ ...custom, [field]: value });
    onPreset("custom");
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((item) => (
          <Button
            key={item.value}
            variant="outline"
            aria-pressed={preset === item.value}
            className={preset === item.value ? "bg-surface-2" : undefined}
            onClick={() => onPreset(item.value)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          type="date"
          aria-label="С даты"
          className="w-auto"
          value={custom.from}
          onChange={(event) => changeDate("from", event.target.value)}
        />
        <Input
          type="date"
          aria-label="По дату"
          className="w-auto"
          value={custom.to}
          onChange={(event) => changeDate("to", event.target.value)}
        />
        <SegmentedControl<Group>
          ariaLabel="Группировка"
          value={group}
          onChange={onGroup}
          options={[
            { value: "day", label: "По дням" },
            { value: "week", label: "По неделям" },
            { value: "month", label: "По месяцам" },
          ]}
        />
      </div>
    </div>
  );
}

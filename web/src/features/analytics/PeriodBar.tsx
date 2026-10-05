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
  /** The range currently in effect, whether it comes from a preset or from the date inputs. */
  range: DateRange;
  onRange: (range: DateRange) => void;
  rangeError?: boolean;
  group: Group;
  onGroup: (group: Group) => void;
}

export function PeriodBar({ preset, onPreset, range, onRange, rangeError = false, group, onGroup }: PeriodBarProps) {
  function changeDate(field: keyof DateRange, value: string) {
    if (!value) return;
    onRange({ ...range, [field]: value });
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
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
          max={range.to}
          value={range.from}
          onChange={(event) => changeDate("from", event.target.value)}
        />
        <Input
          type="date"
          aria-label="По дату"
          className="w-auto"
          min={range.from}
          value={range.to}
          onChange={(event) => changeDate("to", event.target.value)}
        />
        {/* Breathing room for the labels, scoped here so other segmented controls are unchanged. */}
        <div className="[&_button]:px-3">
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
      {rangeError && (
        <p role="alert" className="text-sm text-status-circle">
          Дата «с» позже даты «по»
        </p>
      )}
    </div>
  );
}

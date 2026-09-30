import { formatClock } from "@/lib/bishkek";

interface LatePackageWarningProps {
  endsAtMs: number;
  plannedClose: string;
}

/** Advisory only (SPEC §3.6): selling a package past closing is the operator's call. */
export function LatePackageWarning({ endsAtMs, plannedClose }: LatePackageWarningProps) {
  return (
    <p className="note note-warn">
      <span aria-hidden className="mr-1 font-bold text-status-amber-text">!</span>
      Пакет закончится в {formatClock(endsAtMs)} — после планового закрытия ({plannedClose}). Продавать или нет — решаете вы.
    </p>
  );
}

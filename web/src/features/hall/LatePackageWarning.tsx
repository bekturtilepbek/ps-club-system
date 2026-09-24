interface LatePackageWarningProps {
  plannedClose: string | undefined;
}

export function LatePackageWarning({ plannedClose }: LatePackageWarningProps) {
  if (!plannedClose) return null;
  return (
    <p className="text-sm text-amber-600">
      Пакет закончится после планового закрытия ({plannedClose}). Решение — за администратором.
    </p>
  );
}

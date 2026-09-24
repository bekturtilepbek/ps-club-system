let offsetMs = 0;

export function updateClockOffset(serverIso: string): void {
  offsetMs = new Date(serverIso).getTime() - Date.now();
}

export function serverNow(): number {
  return Date.now() + offsetMs;
}

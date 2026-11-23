function formatTimestamp(): string {
  const now = new Date();
  const iso = now.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

export function formatDurationShort(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

export function logInfo(scope: string, message: string): void {
  console.log(`[${formatTimestamp()}] [INFO]  [${scope}] ${message}`);
}

export function logWarn(scope: string, message: string): void {
  console.warn(`[${formatTimestamp()}] [WARN]  [${scope}] ${message}`);
}

export function logError(scope: string, message: string): void {
  console.error(`[${formatTimestamp()}] [ERROR] [${scope}] ${message}`);
}

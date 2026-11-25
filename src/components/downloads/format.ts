export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024))));
  return `${(bytes / 1024 ** index).toFixed(index > 0 ? 1 : 0)} ${units[index]}`;
}

export function formatSpeed(bytesPerSecond: number | undefined): string {
  return `${formatBytes(bytesPerSecond ?? 0)}/s`;
}

export function formatTimeLeft(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "Estimating time left…";
  if (seconds < 1) return "Less than 1s left";
  const rounded = Math.ceil(seconds);
  if (rounded < 60) return `${rounded}s left`;
  if (rounded < 3600) return `${Math.floor(rounded / 60)}m ${rounded % 60}s left`;
  return `${Math.floor(rounded / 3600)}h ${Math.floor(rounded % 3600 / 60)}m left`;
}

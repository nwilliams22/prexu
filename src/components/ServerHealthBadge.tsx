/**
 * Small colored dot indicating server connection health.
 * Green = online, yellow = degraded/slow, red = offline.
 */

import type { HealthStatus } from "../hooks/useServerHealth";

interface ServerHealthBadgeProps {
  status: HealthStatus;
  latencyMs: number | null;
}

const STATUS_COLORS: Record<HealthStatus, string> = {
  online: "#4caf50",
  degraded: "#ffc107",
  offline: "#f44336",
};

const STATUS_LABELS: Record<HealthStatus, string> = {
  online: "Connected",
  degraded: "Slow connection",
  offline: "Offline",
};

export default function ServerHealthBadge({
  status,
  latencyMs,
}: ServerHealthBadgeProps) {
  const tooltip = latencyMs != null
    ? `${STATUS_LABELS[status]} (${latencyMs}ms)`
    : STATUS_LABELS[status];

  return (
    <span
      title={tooltip}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        backgroundColor: STATUS_COLORS[status],
        boxShadow: `0 0 4px ${STATUS_COLORS[status]}`,
        flexShrink: 0,
      }}
    />
  );
}

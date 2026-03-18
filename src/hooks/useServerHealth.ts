/**
 * Server connection health monitoring.
 * Pings the Plex server periodically and tracks status + latency.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { serverFetch } from "../services/plex-api";

export type HealthStatus = "online" | "degraded" | "offline";

export interface ServerHealthResult {
  status: HealthStatus;
  latencyMs: number | null;
  lastChecked: number | null;
}

const PING_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 32_000;
const DEGRADED_LATENCY_MS = 200;

export function useServerHealth(
  server: { uri: string; accessToken: string } | null,
): ServerHealthResult {
  const [status, setStatus] = useState<HealthStatus>("online");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const backoffRef = useRef(2000);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const checkHealth = useCallback(async () => {
    if (!server) return;

    const start = performance.now();
    try {
      const resp = await serverFetch(server.uri, server.accessToken, "/identity");
      const elapsed = Math.round(performance.now() - start);

      if (resp.ok) {
        setLatencyMs(elapsed);
        setStatus(elapsed > DEGRADED_LATENCY_MS ? "degraded" : "online");
        backoffRef.current = 2000; // Reset backoff on success
      } else {
        setStatus("offline");
        setLatencyMs(null);
      }
    } catch {
      setStatus("offline");
      setLatencyMs(null);
    }
    setLastChecked(Date.now());
  }, [server]);

  useEffect(() => {
    if (!server) {
      setStatus("offline");
      setLatencyMs(null);
      return;
    }

    // Initial check
    checkHealth();

    const schedule = () => {
      const delay = status === "offline"
        ? Math.min(backoffRef.current, MAX_BACKOFF_MS)
        : PING_INTERVAL_MS;

      if (status === "offline") {
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      }

      timerRef.current = setTimeout(() => {
        checkHealth().then(schedule);
      }, delay);
    };

    schedule();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [server, checkHealth, status]);

  return { status, latencyMs, lastChecked };
}

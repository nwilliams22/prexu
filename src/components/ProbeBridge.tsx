import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePlayerSession } from "../contexts/PlayerContext";
import { createProbeStarter, type ProbeScript } from "../services/probe-runner";
import { createLiveProbeAdapter } from "../services/probe-live";
import type { ProbeSnapshot } from "../services/probe-observer";
import { logger } from "../services/logger";

/** Mounted only after native preflight authorized fixture auth. */
export default function ProbeBridge() {
  const session = usePlayerSession();
  const location = useLocation();
  const navigate = useNavigate();
  const latest = useRef({ session, location, navigate });
  useEffect(() => { latest.current = { session, location, navigate }; });
  const starter = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (!starter.current) {
      const window = getCurrentWindow();
      const adapter = createLiveProbeAdapter({
        play: () => latest.current.session.play("av-cues-v1", { offset: 0 }),
        stop: () => latest.current.session.stop(),
        hasSession: () => latest.current.session.session !== null,
        route: () => latest.current.location.pathname,
        navigate: (route) => latest.current.navigate(route),
        snapshot: () => invoke<ProbeSnapshot>("probe_driver", { request: { operation: "snapshot" } }),
        windowMinimize: () => window.minimize(),
        windowRestore: () => window.unminimize(),
        windowMinimized: () => window.isMinimized(),
      });
      starter.current = createProbeStarter((request) => invoke<ProbeScript | null>("probe_driver", { request }), adapter);
    }
    // StrictMode effect replay uses the same one-shot starter.
    void starter.current().catch(() => logger.error("probe", "probe_execution_failed"));
  }, []);
  return null;
}

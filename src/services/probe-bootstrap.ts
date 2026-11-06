import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AuthContextValue } from "../hooks/useAuth";

/** Native preflight is the only activation authority; never read URL/storage flags. */
export async function readProbeBootstrap(): Promise<AuthContextValue | null> {
  if (!isTauri()) return null;
  let value: unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    value = await Promise.race([
      invoke("probe_driver", { request: { operation: "bootstrap" } }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("probe_bootstrap_failed")), 5000);
      }),
    ]);
  } catch (error) {
    // The command is compiled out in release. Other IPC failures must not
    // silently turn a probe into an ordinary authenticated application.
    if (error === "Command probe_driver not found") return null;
    throw new Error("probe_bootstrap_failed");
  } finally {
    clearTimeout(timer);
  }
  if (value === null) return null;
  if (typeof value !== "object" || !("fixtureUrl" in value) ||
      typeof value.fixtureUrl !== "string" ||
      !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(value.fixtureUrl) ||
      Number(value.fixtureUrl.split(":").at(-1)) > 65535) {
    throw new Error("probe_bootstrap_failed");
  }
  const unavailable = async () => { throw new Error("unsupported_action"); };
  return {
    isLoading: false, isAuthenticated: true, serverSelected: true,
    // No account token: account/home-user and invite hooks remain inactive.
    serverUnreachable: false, authToken: null, activeUser: null,
    server: { name: "Probe fixture", clientIdentifier: "probe-fixture",
      accessToken: "probe-fixture", uri: value.fixtureUrl },
    login: unavailable, logout: unavailable, selectServer: unavailable,
    changeServer: unavailable, switchUser: unavailable,
  };
}

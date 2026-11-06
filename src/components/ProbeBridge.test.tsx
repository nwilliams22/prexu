import { StrictMode } from "react";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { PlayerProvider } from "../contexts/PlayerContext";
import ProbeBridge from "./ProbeBridge";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null), isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({
  minimize: vi.fn(), unminimize: vi.fn(), isMinimized: vi.fn(async () => false),
}) }));
vi.mock("../services/logger", () => ({ logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

it("handshakes once through StrictMode effect replay", async () => {
  render(<StrictMode><MemoryRouter><PlayerProvider><ProbeBridge /></PlayerProvider></MemoryRouter></StrictMode>);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("probe_driver", { request: { operation: "ready" } }));
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "probe_driver")).toHaveLength(1);
});

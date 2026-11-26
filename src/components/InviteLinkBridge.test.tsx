import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import InviteLinkBridge from "./InviteLinkBridge";
const navigate = vi.fn();
let auth = { isLoading: false, isAuthenticated: false, serverSelected: false };
let receive: (urls: string[]) => void;
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
const dismissInvite = vi.fn();
vi.mock("../hooks/useInvites", () => ({ useInvites: () => ({ dismissInvite }) }));
vi.mock("../hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@tauri-apps/plugin-deep-link", () => ({
  getCurrent: async () => ["prexu://join/AB12CD34?media=17"],
  onOpenUrl: async (callback: typeof receive) => { receive = callback; return vi.fn(); },
}));
beforeEach(() => { navigate.mockClear(); auth = { isLoading: false, isAuthenticated: false, serverSelected: false }; });
it("retains a cold-start link until sign-in and server selection finish", async () => {
  const view = render(<InviteLinkBridge />);
  await act(async () => {});
  expect(navigate).not.toHaveBeenCalled();
  auth = { ...auth, isAuthenticated: true };
  view.rerender(<InviteLinkBridge />);
  expect(navigate).not.toHaveBeenCalled();
  auth = { ...auth, serverSelected: true };
  view.rerender(<InviteLinkBridge />);
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("/play/17?session=AB12CD34"));
  expect(navigate).toHaveBeenCalledTimes(1);
});
it("rejects a warm link with an attacker relay", async () => {
  render(<InviteLinkBridge />);
  await act(async () => {});
  act(() => receive(["prexu://join/AB12CD34?media=17&relay=wss://evil.test"]));
  expect(screen.getByRole("alert")).toHaveTextContent("invalid");
  expect(navigate).not.toHaveBeenCalled();
});

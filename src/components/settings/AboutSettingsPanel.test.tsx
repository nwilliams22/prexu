import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { open } from "@tauri-apps/plugin-shell";
import { AboutSettingsPanel } from "./AboutSettingsPanel";
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));
it("sanitizes server information and preserves both support destinations", async () => {
  render(<AboutSettingsPanel isAdmin serverUri="https://user:password@plex.test/path?X-Plex-Token=private#secret" />);
  expect(document.body.textContent).not.toMatch(/password|private|secret/);
  await userEvent.click(screen.getByRole("button", { name: "Report a bug" }));
  expect(open).toHaveBeenCalledWith("https://github.com/nwilliams22/prexu/issues/new");
  vi.mocked(open).mockRejectedValueOnce(new Error("open"));
  await userEvent.click(screen.getByRole("button", { name: "GitHub" }));
  expect(open).toHaveBeenCalledWith("https://github.com/nwilliams22/prexu");
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not open the link. Try again.");
  expect(screen.getByText("Relay administrator setup")).toBeVisible();
});
it("omits administrator setup for a non-admin and states missing server", () => {
  render(<AboutSettingsPanel isAdmin={false} />);
  expect(screen.getByText("No server selected")).toBeVisible();
  expect(screen.queryByText("Relay administrator setup")).toBeNull();
});

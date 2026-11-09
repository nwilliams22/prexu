import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectionsSettingsPanel } from "./ConnectionsSettingsPanel";
import * as storage from "../../services/storage";
import * as audio from "../../utils/notificationSound";

vi.mock("../../services/storage", async (original) => ({ ...await original<typeof storage>(),
  getRelayUrl: vi.fn(), hasManualRelayUrl: vi.fn(), saveRelayUrl: vi.fn(), clearRelayUrl: vi.fn(),
  getInviteVolume: vi.fn(), saveInviteVolume: vi.fn(), getInviteSoundConfig: vi.fn(), saveInviteSoundConfig: vi.fn(),
}));
vi.mock("../../utils/notificationSound", () => ({ previewSound: vi.fn(), previewCustomDataUrl: vi.fn(), validateCustomSound: vi.fn() }));
const refresh = vi.fn();
function panel(serverUri?: string) { return render(<ConnectionsSettingsPanel serverUri={serverUri} isRelayConnected={false} refreshInvites={refresh} />); }
async function edit() { await userEvent.click(await screen.findByRole("button", { name: "Use custom relay URL" })); return screen.getByRole("textbox", { name: "Custom relay URL" }); }

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(storage.hasManualRelayUrl).mockResolvedValue(false);
  vi.mocked(storage.getInviteVolume).mockResolvedValue(0.5);
  vi.mocked(storage.getInviteSoundConfig).mockResolvedValue({ sound: "chime" });
  vi.mocked(audio.validateCustomSound).mockResolvedValue({} as AudioBuffer);
});

it("does not claim connection success or detect localhost without a server", async () => {
  panel();
  expect(await screen.findByText("Automatic")).toBeVisible();
  expect(screen.getByText("No server selected")).toBeVisible();
  expect(screen.getByText("Not connected")).toBeVisible();
  expect(screen.queryByText(/localhost/)).toBeNull();
});
it("validates and trims a URL, retains path/query, and refreshes only after saving", async () => {
  let finish!: () => void;
  vi.mocked(storage.saveRelayUrl).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  panel(); const input = await edit();
  fireEvent.change(input, { target: { value: "https://relay.test" } });
  expect(screen.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  fireEvent.change(input, { target: { value: "  wss://relay.test/path?mode=one  " } });
  await userEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  expect(storage.saveRelayUrl).toHaveBeenCalledWith("wss://relay.test/path?mode=one");
  expect(refresh).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  finish();
  expect(await screen.findByText("Relay address saved")).toBeVisible();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Not connected")).toBeVisible();
  expect(screen.getByRole("button", { name: "Edit relay URL" })).toHaveFocus();
});
it("retains failed relay drafts and the saved mode when reset fails", async () => {
  vi.mocked(storage.hasManualRelayUrl).mockResolvedValue(true);
  vi.mocked(storage.getRelayUrl).mockResolvedValue("wss://user:secret@relay.test/ws?token=private");
  vi.mocked(storage.clearRelayUrl).mockRejectedValue(new Error("disk"));
  vi.mocked(storage.saveRelayUrl).mockRejectedValue(new Error("disk"));
  panel("https://plex.test");
  await userEvent.click(await screen.findByRole("button", { name: "Reset to auto-detect" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save relay address");
  expect(screen.getByText("Custom", { selector: "p" })).toBeVisible();
  expect(document.body.textContent).not.toContain("secret");
  expect(document.body.textContent).not.toContain("private");
  await userEvent.click(screen.getByRole("button", { name: "Edit relay URL" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "ws://new.test/ws" } });
  await userEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not save relay address"));
  expect(screen.getByRole("textbox")).toHaveValue("ws://new.test/ws");
  expect(refresh).not.toHaveBeenCalled();
});
it("plays only an explicit preview and disables it at zero volume", async () => {
  panel(); await screen.findByText("Automatic");
  await userEvent.click(screen.getByRole("radio", { name: "Bell" }));
  expect(audio.previewSound).not.toHaveBeenCalled();
  const preview = screen.getByRole("button", { name: "Preview sound" });
  preview.focus(); await userEvent.keyboard("{Enter}");
  expect(audio.previewSound).toHaveBeenCalledWith("bell", 0.5);
  fireEvent.change(screen.getByRole("slider"), { target: { value: "0" } });
  expect(preview).toBeDisabled();
  expect(screen.getByText("Increase volume to preview.")).toBeVisible();
});
it("custom cancellation and decode failure preserve the previous saved choice", async () => {
  panel(); await screen.findByText("Automatic");
  await userEvent.click(screen.getByRole("radio", { name: "Custom", exact: true }));
  expect(screen.getByRole("radio", { name: "Chime" })).toBeChecked();
  expect(storage.saveInviteSoundConfig).not.toHaveBeenCalled();
  vi.mocked(audio.validateCustomSound).mockRejectedValue(new Error("decode"));
  const file = new File(["invalid"], "broken.wav", { type: "audio/wav" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(3) });
  fireEvent.change(screen.getByLabelText("Choose audio file"), { target: { files: [file] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("This audio file could not be loaded");
  expect(screen.getByRole("radio", { name: "Chime" })).toBeChecked();
  expect(storage.saveInviteSoundConfig).not.toHaveBeenCalled();
});
it("saves decoded custom data without playing, then previews custom data", async () => {
  panel(); await screen.findByText("Automatic");
  const file = new File(["audio"], "sound.wav", { type: "audio/wav" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(3) });
  fireEvent.change(screen.getByLabelText("Choose audio file"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByRole("radio", { name: "Custom" })).toBeChecked());
  await waitFor(() => expect(screen.getByRole("button", { name: "Preview sound" })).toBeEnabled());
  expect(audio.previewCustomDataUrl).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Preview sound" }));
  expect(audio.previewCustomDataUrl).toHaveBeenCalledWith("data:audio/wav;base64,AAAA", 0.5);
  expect(audio.previewSound).not.toHaveBeenCalled();
});
it.each([undefined, "data:audio/wav;base64,broken"])("does not preview an invalid saved custom file (%s)", async (data) => {
  vi.mocked(storage.getInviteSoundConfig).mockResolvedValue({ sound: "custom", customDataUrl: data });
  vi.mocked(audio.validateCustomSound).mockRejectedValue(new Error("decode"));
  panel(); await screen.findByText("Automatic");
  expect(screen.getByRole("button", { name: "Preview sound" })).toBeDisabled();
  expect(audio.previewSound).not.toHaveBeenCalled();
});
it("serializes rapid volume writes, retains failures, and retries the latest draft", async () => {
  let finish!: () => void;
  vi.mocked(storage.saveInviteVolume).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockRejectedValueOnce(new Error("disk")).mockResolvedValue(undefined);
  panel(); await screen.findByText("Automatic");
  fireEvent.change(screen.getByRole("slider"), { target: { value: "70" } });
  fireEvent.change(screen.getByRole("slider"), { target: { value: "80" } });
  await waitFor(() => expect(storage.saveInviteVolume).toHaveBeenCalledTimes(1));
  finish();
  await userEvent.click(await screen.findByRole("button", { name: "Retry", exact: true }));
  await waitFor(() => expect(storage.saveInviteVolume).toHaveBeenLastCalledWith(0.8));
  expect(await screen.findByText("Saved")).toBeVisible();
});
it("blocks editing until hydration succeeds", async () => {
  vi.mocked(storage.getInviteVolume).mockRejectedValueOnce(new Error("read")).mockResolvedValue(0.75);
  panel(); await screen.findByText("Could not load settings");
  expect(screen.getByRole("slider")).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.getByRole("slider")).toHaveValue("75"));
  expect(storage.saveInviteVolume).not.toHaveBeenCalled();
});

it("retrying a failed volume read preserves an unsaved sound draft", async () => {
  vi.mocked(storage.getInviteVolume).mockRejectedValueOnce(new Error("read")).mockResolvedValue(0.75);
  vi.mocked(storage.saveInviteSoundConfig).mockRejectedValue(new Error("write"));
  panel();
  await screen.findByText("Could not load settings");
  await userEvent.click(screen.getByRole("radio", { name: "Bell" }));
  await screen.findByText("Not saved");
  await userEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.getByRole("slider")).toHaveValue("75"));
  expect(screen.getByRole("radio", { name: "Bell" })).toBeChecked();
  expect(screen.getByText("Not saved")).toBeVisible();
});

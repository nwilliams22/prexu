import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import WatchTogetherLobby, { type WatchTogetherLobbyProps } from "./WatchTogetherLobby";

function props(): WatchTogetherLobbyProps {
  return {
    snapshot: {
      sessionId: "room", mediaTitle: "QA movie", mediaRatingKey: "2", mediaType: "movie",
      phase: "lobby", hostAway: false,
      participants: [
        { plexUsername: "host", plexThumb: "", isHost: true, state: "ready" },
        { plexUsername: "missing", plexThumb: "", isHost: false, state: "invited" },
        { plexUsername: "joining", plexThumb: "", isHost: false, state: "joined-buffering" },
        { plexUsername: "returning", plexThumb: "", isHost: false, state: "reconnecting" },
      ],
    },
    isHost: true, connected: true,
    onStartNow: vi.fn(), onResendInvite: vi.fn(), onRemoveParticipant: vi.fn(), onLeave: vi.fn(),
  };
}

describe("WatchTogetherLobby", () => {
  it("shows the complete authoritative roster without starting playback", () => {
    const p = props();
    const { rerender } = render(<WatchTogetherLobby {...p} />);
    expect(screen.getByRole("heading", { name: "QA movie" })).toBeInTheDocument();
    for (const label of ["Invited", "Joined · buffering", "Ready", "Reconnecting"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    p.snapshot = { ...p.snapshot, participants: p.snapshot.participants.map(person => ({ ...person, state: "ready" })) };
    rerender(<WatchTogetherLobby {...p} />);
    expect(screen.getAllByText("Ready")).toHaveLength(4);
    expect(p.onStartNow).not.toHaveBeenCalled();
  });

  it("allows Start now with a no-show and dispatches per-person host actions", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<WatchTogetherLobby {...p} />);
    await user.click(screen.getByRole("button", { name: "Start now" }));
    expect(p.onStartNow).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Resend invite to missing" }));
    expect(p.onResendInvite).toHaveBeenCalledWith("missing");
    await user.click(screen.getByRole("button", { name: "Cancel invite for missing" }));
    await user.click(screen.getByRole("button", { name: "Remove joining" }));
    expect(p.onRemoveParticipant).toHaveBeenNthCalledWith(1, "missing");
    expect(p.onRemoveParticipant).toHaveBeenNthCalledWith(2, "joining");
    const hostRow = screen.getByText("host (Host)").closest("li")!;
    expect(within(hostRow).queryByRole("button")).not.toBeInTheDocument();
  });

  it("gives guests the same roster but no host controls", async () => {
    const user = userEvent.setup();
    const p = props();
    render(<WatchTogetherLobby {...p} isHost={false} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Leave session" }));
    expect(p.onLeave).toHaveBeenCalledOnce();
  });

  it.each(["disconnected", "host away"])("disables network actions while %s but permits leaving", async (condition) => {
    const p = props();
    p.connected = condition !== "disconnected";
    p.snapshot.hostAway = condition === "host away";
    render(<WatchTogetherLobby {...p} />);
    expect(screen.getByRole("button", { name: "Start now" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel invite for missing" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel session" })).toBeEnabled();
  });

  it("supports keyboard Start now and has no detectable accessibility violations", async () => {
    const user = userEvent.setup();
    const p = props();
    const { container } = render(<WatchTogetherLobby {...p} />);
    const button = screen.getByRole("button", { name: "Start now" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(p.onStartNow).toHaveBeenCalledOnce();
    expect((await axe(container)).violations).toEqual([]);
  });
});

it("keeps removal available during playback without offering another start", () => {
  const p = props(); p.snapshot.phase = "playback";
  render(<WatchTogetherLobby {...p} />);
  expect(screen.queryByRole("button", { name: "Start now" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove joining" })).toBeEnabled();
  expect(screen.getByRole("status")).toHaveTextContent("Session in progress.");
});

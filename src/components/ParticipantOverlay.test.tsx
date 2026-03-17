import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ParticipantOverlay from "./ParticipantOverlay";
import { createWatchParticipant } from "../__tests__/mocks/plex-data";
import type { WatchParticipant } from "../types/watch-together";

function renderOverlay(participants: WatchParticipant[], visible = true) {
  return render(
    <ParticipantOverlay participants={participants} visible={visible} />
  );
}

describe("ParticipantOverlay", () => {
  it("renders nothing when not visible", () => {
    const participants = [createWatchParticipant({ plexUsername: "alice" })];
    const { container } = renderOverlay(participants, false);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when participants list is empty", () => {
    const { container } = renderOverlay([], true);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when not visible AND empty", () => {
    const { container } = renderOverlay([], false);
    expect(container.innerHTML).toBe("");
  });

  it("renders participant avatars when visible", () => {
    const participants = [
      createWatchParticipant({ plexUsername: "alice", plexThumb: "https://example.com/alice.jpg" }),
      createWatchParticipant({ plexUsername: "bob", plexThumb: "https://example.com/bob.jpg" }),
    ];
    renderOverlay(participants);
    expect(screen.getByAltText("alice")).toBeInTheDocument();
    expect(screen.getByAltText("bob")).toBeInTheDocument();
  });

  it("shows placeholder initial when no thumb is provided", () => {
    const participants = [
      createWatchParticipant({ plexUsername: "charlie", plexThumb: "" }),
    ];
    renderOverlay(participants);
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("shows host badge for host participants", () => {
    const participants = [
      createWatchParticipant({ plexUsername: "host-user", isHost: true }),
    ];
    renderOverlay(participants);
    // The star badge character
    expect(screen.getByText("\u2605")).toBeInTheDocument();
  });

  it("does not show host badge for non-host participants", () => {
    const participants = [
      createWatchParticipant({ plexUsername: "guest-user", isHost: false }),
    ];
    renderOverlay(participants);
    expect(screen.queryByText("\u2605")).not.toBeInTheDocument();
  });

  it("has accessible role and label", () => {
    const participants = [createWatchParticipant({ plexUsername: "user1" })];
    renderOverlay(participants);
    expect(screen.getByRole("status", { name: "Watch Together participants" })).toBeInTheDocument();
  });

  it("sets title attribute with username for each participant", () => {
    const participants = [
      createWatchParticipant({ plexUsername: "alice", plexThumb: "https://example.com/a.jpg" }),
    ];
    renderOverlay(participants);
    const img = screen.getByAltText("alice");
    expect(img.closest("[title='alice']")).toBeTruthy();
  });

  it("renders multiple participants", () => {
    const participants = [
      createWatchParticipant({ plexUsername: "user1", plexThumb: "https://example.com/1.jpg" }),
      createWatchParticipant({ plexUsername: "user2", plexThumb: "https://example.com/2.jpg" }),
      createWatchParticipant({ plexUsername: "user3", plexThumb: "" }),
    ];
    renderOverlay(participants);
    expect(screen.getByAltText("user1")).toBeInTheDocument();
    expect(screen.getByAltText("user2")).toBeInTheDocument();
    expect(screen.getByText("U")).toBeInTheDocument(); // placeholder for user3
  });
});

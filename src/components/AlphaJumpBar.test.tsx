import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AlphaJumpBar from "./AlphaJumpBar";

describe("AlphaJumpBar", () => {
  it("renders all 27 letter buttons", () => {
    render(<AlphaJumpBar onJump={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(27);
  });

  it("renders nav with aria-label", () => {
    render(<AlphaJumpBar onJump={() => {}} />);
    expect(screen.getByRole("navigation", { name: "Jump to letter" })).toBeInTheDocument();
  });

  it("calls onJump with clicked letter", async () => {
    const user = userEvent.setup();
    const onJump = vi.fn();
    render(<AlphaJumpBar onJump={onJump} />);

    await user.click(screen.getByRole("button", { name: "Jump to A" }));
    expect(onJump).toHaveBeenCalledWith("A");
  });

  it("disables letters not in availableLetters", () => {
    const available = new Set(["A", "B", "C"]);
    render(<AlphaJumpBar onJump={() => {}} availableLetters={available} />);

    expect(screen.getByRole("button", { name: "Jump to A" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Jump to Z" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Jump to numbers" })).toBeDisabled();
  });

  it("enables all letters when availableLetters is undefined", () => {
    render(<AlphaJumpBar onJump={() => {}} />);
    const buttons = screen.getAllByRole("button");
    const disabledButtons = buttons.filter((btn) => btn.hasAttribute("disabled"));
    expect(disabledButtons).toHaveLength(0);
  });
});

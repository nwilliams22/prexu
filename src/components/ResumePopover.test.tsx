import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResumePopover from "./ResumePopover";

const defaultProps = {
  viewOffset: 300000,
  anchorPosition: { x: 100, y: 200 },
  onResume: vi.fn(),
  onPlayFromBeginning: vi.fn(),
  onClose: vi.fn(),
};

function renderPopover(overrides = {}) {
  const props = { ...defaultProps, ...overrides };
  return render(<ResumePopover {...props} />);
}

describe("ResumePopover", () => {
  it("renders 'Resume from' with formatted time for minutes", () => {
    renderPopover({ viewOffset: 300000 }); // 5 minutes
    expect(screen.getByText("Resume from 5:00")).toBeInTheDocument();
  });

  it("renders 'Play from Beginning' button", () => {
    renderPopover();
    expect(screen.getByText("Play from Beginning")).toBeInTheDocument();
  });

  it("calls onResume and onClose when Resume is clicked", async () => {
    const onResume = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();

    renderPopover({ onResume, onClose });
    await user.click(screen.getByText("Resume from 5:00"));

    expect(onResume).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onPlayFromBeginning and onClose when Play from Beginning is clicked", async () => {
    const onPlayFromBeginning = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();

    renderPopover({ onPlayFromBeginning, onClose });
    await user.click(screen.getByText("Play from Beginning"));

    expect(onPlayFromBeginning).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape key is pressed", () => {
    const onClose = vi.fn();
    renderPopover({ onClose });

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("formats hours correctly", () => {
    renderPopover({ viewOffset: 3661000 }); // 1h 1m 1s
    expect(screen.getByText("Resume from 1:01:01")).toBeInTheDocument();
  });

  it("is positioned at anchorPosition", () => {
    const { container } = renderPopover({
      anchorPosition: { x: 150, y: 250 },
    });
    const popover = container.firstChild as HTMLElement;
    expect(popover.style.left).toBe("150px");
    expect(popover.style.top).toBe("250px");
  });
});

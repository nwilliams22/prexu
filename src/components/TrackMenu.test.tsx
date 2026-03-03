import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import TrackMenu from "./TrackMenu";
import type { PlexStream } from "../types/library";

describe("TrackMenu", () => {
  const tracks: PlexStream[] = [
    {
      id: 1,
      streamType: 2,
      codec: "aac",
      index: 0,
      displayTitle: "English (AAC Stereo)",
    },
    {
      id: 2,
      streamType: 2,
      codec: "ac3",
      index: 1,
      displayTitle: "Spanish (AC3 5.1)",
    },
  ];

  const defaultProps = {
    label: "Audio",
    tracks,
    selectedId: 1,
    onSelect: vi.fn(),
    onClose: vi.fn(),
  };

  it("renders the header label", () => {
    render(<TrackMenu {...defaultProps} />);
    expect(screen.getByText("Audio")).toBeInTheDocument();
  });

  it("renders all tracks", () => {
    render(<TrackMenu {...defaultProps} />);
    expect(screen.getByText("English (AAC Stereo)")).toBeInTheDocument();
    expect(screen.getByText("Spanish (AC3 5.1)")).toBeInTheDocument();
  });

  it("shows checkmark for selected track", () => {
    const { container } = render(<TrackMenu {...defaultProps} selectedId={1} />);

    // Find the button for the selected track
    const buttons = container.querySelectorAll("button");
    const selectedButton = Array.from(buttons).find((btn) =>
      btn.textContent?.includes("English (AAC Stereo)")
    );

    expect(selectedButton?.textContent).toContain("✓");
  });

  it("does not show checkmark for unselected track", () => {
    const { container } = render(<TrackMenu {...defaultProps} selectedId={1} />);

    const buttons = container.querySelectorAll("button");
    const unselectedButton = Array.from(buttons).find((btn) =>
      btn.textContent?.includes("Spanish (AC3 5.1)")
    );

    // The checkmark span should be empty for unselected
    const checkmark = unselectedButton?.querySelector("span");
    expect(checkmark?.textContent).toBe("");
  });

  it("calls onSelect and onClose when a track is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(<TrackMenu {...defaultProps} onSelect={onSelect} onClose={onClose} />);
    await user.click(screen.getByText("Spanish (AC3 5.1)"));

    expect(onSelect).toHaveBeenCalledWith(2);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders None option when allowNone is true", () => {
    render(<TrackMenu {...defaultProps} allowNone />);
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("does not render None option when allowNone is false", () => {
    render(<TrackMenu {...defaultProps} allowNone={false} />);
    expect(screen.queryByText("None")).not.toBeInTheDocument();
  });

  it("calls onSelect(null) when None is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <TrackMenu {...defaultProps} allowNone onSelect={onSelect} onClose={onClose} />
    );

    await user.click(screen.getByText("None"));

    expect(onSelect).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows checkmark on None when selectedId is null", () => {
    const { container } = render(
      <TrackMenu {...defaultProps} allowNone selectedId={null} />
    );

    const buttons = container.querySelectorAll("button");
    const noneButton = Array.from(buttons).find((btn) =>
      btn.textContent?.includes("None")
    );

    expect(noneButton?.textContent).toContain("✓");
  });

  it("calls onClose when backdrop is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    const { container } = render(
      <TrackMenu {...defaultProps} onClose={onClose} />
    );

    // The backdrop is the outer fixed div
    const backdrop = container.firstChild as HTMLElement;
    await user.click(backdrop);

    expect(onClose).toHaveBeenCalled();
  });

  it("has no axe violations", async () => {
    const { container } = render(<TrackMenu {...defaultProps} />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

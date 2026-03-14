import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import AudioEnhancementsPanel from "./AudioEnhancementsPanel";
import type { AudioEnhancementsResult } from "../hooks/useAudioEnhancements";

// Mock useFocusTrap to avoid DOM measurement issues in jsdom
vi.mock("../hooks/useFocusTrap", () => ({
  useFocusTrap: vi.fn(),
}));

function makeEnhancements(
  overrides: Partial<AudioEnhancementsResult> = {},
): AudioEnhancementsResult {
  return {
    volumeBoost: 1.0,
    setVolumeBoost: vi.fn(),
    setMainBoost: vi.fn(),
    normalizationPreset: "off",
    setNormalizationPreset: vi.fn(),
    audioOffsetMs: 0,
    setAudioOffsetMs: vi.fn(),
    isInitialized: true,
    ...overrides,
  };
}

// The backdrop div uses aria-hidden="true", so we need { hidden: true } for
// role-based queries to find elements inside it.
const HIDDEN = { hidden: true } as const;

describe("AudioEnhancementsPanel", () => {
  const defaultProps = {
    enhancements: makeEnhancements(),
    onClose: vi.fn(),
    onPersist: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the title", () => {
    render(<AudioEnhancementsPanel {...defaultProps} />);
    expect(screen.getByText("Audio Enhancements")).toBeInTheDocument();
  });

  it("renders gain slider with correct value", () => {
    const enhancements = makeEnhancements({ volumeBoost: 2.5 });
    render(
      <AudioEnhancementsPanel {...defaultProps} enhancements={enhancements} />,
    );

    expect(screen.getByText("Gain: 250%")).toBeInTheDocument();
    const slider = screen.getByRole("slider", { ...HIDDEN, name: /audio gain/i });
    expect(slider).toHaveValue("2.5");
  });

  it("calls setVolumeBoost and onPersist when gain slider changes", () => {
    const enhancements = makeEnhancements();
    const onPersist = vi.fn();
    render(
      <AudioEnhancementsPanel
        {...defaultProps}
        enhancements={enhancements}
        onPersist={onPersist}
      />,
    );

    const slider = screen.getByRole("slider", { ...HIDDEN, name: /audio gain/i });
    fireEvent.change(slider, { target: { value: "3" } });

    expect(enhancements.setVolumeBoost).toHaveBeenCalledWith(3);
    expect(onPersist).toHaveBeenCalledWith({ volumeBoost: 3 });
  });

  it("renders normalization preset buttons", () => {
    render(<AudioEnhancementsPanel {...defaultProps} />);

    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Night")).toBeInTheDocument();
  });

  it("marks active preset with aria-pressed", () => {
    const enhancements = makeEnhancements({ normalizationPreset: "light" });
    render(
      <AudioEnhancementsPanel {...defaultProps} enhancements={enhancements} />,
    );

    expect(screen.getByText("Light")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Off")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Night")).toHaveAttribute("aria-pressed", "false");
  });

  it("calls setNormalizationPreset and onPersist when preset button clicked", async () => {
    const user = userEvent.setup();
    const enhancements = makeEnhancements();
    const onPersist = vi.fn();
    render(
      <AudioEnhancementsPanel
        {...defaultProps}
        enhancements={enhancements}
        onPersist={onPersist}
      />,
    );

    await user.click(screen.getByText("Night"));

    expect(enhancements.setNormalizationPreset).toHaveBeenCalledWith("night");
    expect(onPersist).toHaveBeenCalledWith({ normalizationPreset: "night" });
  });

  it("renders audio offset slider with correct value", () => {
    const enhancements = makeEnhancements({ audioOffsetMs: 150 });
    render(
      <AudioEnhancementsPanel {...defaultProps} enhancements={enhancements} />,
    );

    expect(screen.getByText("Audio Offset: 150ms")).toBeInTheDocument();
    const slider = screen.getByRole("slider", { ...HIDDEN, name: /audio offset/i });
    expect(slider).toHaveValue("150");
  });

  it("calls setAudioOffsetMs and onPersist when offset slider changes", () => {
    const enhancements = makeEnhancements();
    const onPersist = vi.fn();
    render(
      <AudioEnhancementsPanel
        {...defaultProps}
        enhancements={enhancements}
        onPersist={onPersist}
      />,
    );

    const slider = screen.getByRole("slider", { ...HIDDEN, name: /audio offset/i });
    fireEvent.change(slider, { target: { value: "200" } });

    expect(enhancements.setAudioOffsetMs).toHaveBeenCalledWith(200);
    expect(onPersist).toHaveBeenCalledWith({ audioOffsetMs: 200 });
  });

  it("shows Reset button only when offset > 0", () => {
    const { rerender } = render(<AudioEnhancementsPanel {...defaultProps} />);

    // Offset is 0 — no Reset button
    expect(screen.queryByText("Reset")).not.toBeInTheDocument();

    // Offset > 0 — Reset button visible
    const enhancements = makeEnhancements({ audioOffsetMs: 100 });
    rerender(
      <AudioEnhancementsPanel {...defaultProps} enhancements={enhancements} />,
    );
    expect(screen.getByText("Reset")).toBeInTheDocument();
  });

  it("resets offset when Reset is clicked", async () => {
    const user = userEvent.setup();
    const enhancements = makeEnhancements({ audioOffsetMs: 250 });
    const onPersist = vi.fn();
    render(
      <AudioEnhancementsPanel
        {...defaultProps}
        enhancements={enhancements}
        onPersist={onPersist}
      />,
    );

    await user.click(screen.getByText("Reset"));

    expect(enhancements.setAudioOffsetMs).toHaveBeenCalledWith(0);
    expect(onPersist).toHaveBeenCalledWith({ audioOffsetMs: 0 });
  });

  it("calls onClose when backdrop is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(
      <AudioEnhancementsPanel {...defaultProps} onClose={onClose} />,
    );

    // Backdrop is the outer div
    const backdrop = container.firstChild as HTMLElement;
    await user.click(backdrop);

    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <AudioEnhancementsPanel {...defaultProps} onClose={onClose} />,
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("renders dialog with correct accessibility attributes", () => {
    render(<AudioEnhancementsPanel {...defaultProps} />);

    const dialog = screen.getByRole("dialog", HIDDEN);
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "Audio enhancements");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <AudioEnhancementsPanel {...defaultProps} />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

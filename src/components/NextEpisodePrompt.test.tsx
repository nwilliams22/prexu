import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import NextEpisodePrompt from "./NextEpisodePrompt";

const defaultProps = {
  nextEpisodeTitle: "Ozymandias",
  participantCount: 2,
  onContinue: vi.fn(),
  onEndSession: vi.fn(),
};

describe("NextEpisodePrompt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders alertdialog role", () => {
    render(<NextEpisodePrompt {...defaultProps} />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("shows next episode title", () => {
    render(<NextEpisodePrompt {...defaultProps} />);
    expect(screen.getByText("Ozymandias")).toBeInTheDocument();
  });

  it("shows participant count with correct plural for multiple friends", () => {
    render(<NextEpisodePrompt {...defaultProps} participantCount={2} />);
    expect(screen.getByText("2 friends")).toBeInTheDocument();
  });

  it("shows participant count with singular for one friend", () => {
    render(<NextEpisodePrompt {...defaultProps} participantCount={1} />);
    expect(screen.getByText("1 friend")).toBeInTheDocument();
  });

  it("shows countdown starting at 30", () => {
    render(<NextEpisodePrompt {...defaultProps} />);
    expect(screen.getByText("End Session (30s)")).toBeInTheDocument();
  });

  it("decrements countdown each second", () => {
    render(<NextEpisodePrompt {...defaultProps} />);

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("End Session (29s)")).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("End Session (28s)")).toBeInTheDocument();
  });

  it("calls onEndSession when countdown reaches 0", () => {
    render(<NextEpisodePrompt {...defaultProps} />);

    act(() => { vi.advanceTimersByTime(30000); });

    expect(defaultProps.onEndSession).toHaveBeenCalled();
  });

  it("calls onContinue when Continue button is clicked", () => {
    render(<NextEpisodePrompt {...defaultProps} />);

    fireEvent.click(screen.getByText("Continue Together"));

    expect(defaultProps.onContinue).toHaveBeenCalledOnce();
  });

  it("calls onEndSession when End Session button is clicked", () => {
    render(<NextEpisodePrompt {...defaultProps} />);

    fireEvent.click(screen.getByText(/End Session/));

    expect(defaultProps.onEndSession).toHaveBeenCalled();
  });
});

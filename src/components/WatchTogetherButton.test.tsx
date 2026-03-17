import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WatchTogetherButton from "./WatchTogetherButton";

vi.mock("./SessionCreator", () => ({
  default: ({
    onClose,
    ratingKey,
    title,
    mediaType,
  }: {
    onClose: () => void;
    ratingKey: string;
    title: string;
    mediaType: string;
  }) => (
    <div data-testid="session-creator" data-ratingkey={ratingKey} data-title={title} data-mediatype={mediaType}>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));

const defaultProps = {
  ratingKey: "123",
  title: "Breaking Bad S01E01",
  mediaType: "episode" as const,
};

describe("WatchTogetherButton", () => {
  it("renders 'Watch Together' button text", () => {
    render(<WatchTogetherButton {...defaultProps} />);
    expect(screen.getByText("Watch Together")).toBeInTheDocument();
  });

  it("does not show SessionCreator initially", () => {
    render(<WatchTogetherButton {...defaultProps} />);
    expect(screen.queryByTestId("session-creator")).not.toBeInTheDocument();
  });

  it("shows SessionCreator after clicking the button", async () => {
    const user = userEvent.setup();
    render(<WatchTogetherButton {...defaultProps} />);

    await user.click(screen.getByText("Watch Together"));

    expect(screen.getByTestId("session-creator")).toBeInTheDocument();
  });

  it("hides SessionCreator when onClose is called", async () => {
    const user = userEvent.setup();
    render(<WatchTogetherButton {...defaultProps} />);

    await user.click(screen.getByText("Watch Together"));
    expect(screen.getByTestId("session-creator")).toBeInTheDocument();

    await user.click(screen.getByText("Close"));
    expect(screen.queryByTestId("session-creator")).not.toBeInTheDocument();
  });

  it("passes correct props to SessionCreator", async () => {
    const user = userEvent.setup();
    render(<WatchTogetherButton {...defaultProps} />);

    await user.click(screen.getByText("Watch Together"));

    const creator = screen.getByTestId("session-creator");
    expect(creator).toHaveAttribute("data-ratingkey", "123");
    expect(creator).toHaveAttribute("data-title", "Breaking Bad S01E01");
    expect(creator).toHaveAttribute("data-mediatype", "episode");
  });
});

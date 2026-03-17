import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ProgressBar from "./ProgressBar";

describe("ProgressBar", () => {
  it("renders with progressbar role", () => {
    render(<ProgressBar value={0.5} />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
  });

  it("sets aria-valuenow to percentage", () => {
    render(<ProgressBar value={0.75} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "75");
  });

  it("clamps value below 0 to 0", () => {
    render(<ProgressBar value={-0.5} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("clamps value above 1 to 100", () => {
    render(<ProgressBar value={2} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("uses default height of 4px", () => {
    render(<ProgressBar value={0.5} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.style.height).toBe("4px");
  });

  it("accepts custom height", () => {
    render(<ProgressBar value={0.5} height={8} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.style.height).toBe("8px");
  });

  it("accepts custom style prop", () => {
    render(<ProgressBar value={0.5} style={{ marginTop: "10px" }} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.style.marginTop).toBe("10px");
  });

  it("rounds aria-valuenow to nearest integer", () => {
    render(<ProgressBar value={0.333} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "33");
  });
});

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SectionHeader from "./SectionHeader";

describe("SectionHeader", () => {
  it("renders title text", () => {
    render(<SectionHeader title="In This Collection" />);
    expect(screen.getByText("In This Collection")).toBeInTheDocument();
  });

  it("shows count with plural suffix", () => {
    render(<SectionHeader title="Movies" count={12} />);
    expect(screen.getByText("12 items")).toBeInTheDocument();
  });

  it("shows count with singular suffix for count=1", () => {
    render(<SectionHeader title="Movies" count={1} />);
    expect(screen.getByText("1 item")).toBeInTheDocument();
  });

  it("uses custom countSuffix", () => {
    render(<SectionHeader title="Season 1" count={5} countSuffix="episodes" />);
    expect(screen.getByText("5 episodes")).toBeInTheDocument();
  });

  it("hides count when not provided", () => {
    const { container } = render(<SectionHeader title="Recently Added" />);
    const spans = container.querySelectorAll("span");
    expect(spans).toHaveLength(0);
  });
});

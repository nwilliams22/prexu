import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import LibraryIcon from "./LibraryIcon";

describe("LibraryIcon", () => {
  it("renders an svg element", () => {
    const { container } = render(<LibraryIcon type="movie" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });

  it("uses default size of 20", () => {
    const { container } = render(<LibraryIcon type="movie" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("height")).toBe("20");
  });

  it("accepts custom size", () => {
    const { container } = render(<LibraryIcon type="movie" size={32} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("32");
    expect(svg.getAttribute("height")).toBe("32");
  });

  it("uses default color of currentColor", () => {
    const { container } = render(<LibraryIcon type="movie" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("stroke")).toBe("currentColor");
  });

  it("accepts custom color", () => {
    const { container } = render(<LibraryIcon type="show" color="#ff0000" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("stroke")).toBe("#ff0000");
  });

  it("renders film icon for movie type (has rect)", () => {
    const { container } = render(<LibraryIcon type="movie" />);
    const rect = container.querySelector("rect");
    expect(rect).toBeInTheDocument();
    expect(rect!.getAttribute("x")).toBe("2");
    expect(rect!.getAttribute("y")).toBe("2");
  });

  it("renders TV icon for show type", () => {
    const { container } = render(<LibraryIcon type="show" />);
    const rect = container.querySelector("rect");
    expect(rect).toBeInTheDocument();
    // show rect has y=3 (different from movie y=2)
    expect(rect!.getAttribute("y")).toBe("3");
  });

  it("renders music icon for artist type (has circles)", () => {
    const { container } = render(<LibraryIcon type="artist" />);
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBe(2);
  });

  it("renders camera icon for photo type", () => {
    const { container } = render(<LibraryIcon type="photo" />);
    const circle = container.querySelector("circle");
    expect(circle).toBeInTheDocument();
    expect(circle!.getAttribute("cx")).toBe("12");
    expect(circle!.getAttribute("cy")).toBe("13");
  });

  it("renders generic folder icon for unknown type", () => {
    const { container } = render(
      <LibraryIcon type={"other" as "movie"} />
    );
    // Folder icon has a single path, no rect or circle
    const rect = container.querySelector("rect");
    const circle = container.querySelector("circle");
    expect(rect).not.toBeInTheDocument();
    expect(circle).not.toBeInTheDocument();
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBe(1);
  });

  it("all icon types share viewBox 0 0 24 24", () => {
    const types = ["movie", "show", "artist", "photo"] as const;
    for (const type of types) {
      const { container } = render(<LibraryIcon type={type} />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    }
  });
});

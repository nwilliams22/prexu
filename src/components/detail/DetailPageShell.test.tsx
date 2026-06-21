import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DetailPageShell from "./DetailPageShell";

const slots = {
  header: <h1>Header</h1>,
  toolbar: <div>Toolbar</div>,
  errorSlot: <div>Error happened</div>,
  loadingSlot: <div>Loading…</div>,
  emptySlot: <div>Nothing here</div>,
  children: <div>Body content</div>,
  overlays: <div>Overlay</div>,
};

describe("DetailPageShell", () => {
  it("renders the body when not loading/error/empty", () => {
    render(
      <DetailPageShell
        isError={false}
        isLoading={false}
        isEmpty={false}
        {...slots}
      />,
    );

    expect(screen.getByText("Header")).toBeInTheDocument();
    expect(screen.getByText("Toolbar")).toBeInTheDocument();
    expect(screen.getByText("Body content")).toBeInTheDocument();
    expect(screen.getByText("Overlay")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(screen.queryByText("Error happened")).not.toBeInTheDocument();
    expect(screen.queryByText("Nothing here")).not.toBeInTheDocument();
  });

  it("renders the loading slot while loading and hides the body", () => {
    render(
      <DetailPageShell
        isError={false}
        isLoading={true}
        isEmpty={false}
        {...slots}
      />,
    );

    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("Body content")).not.toBeInTheDocument();
    // Header is always shown so the page is framed during load
    expect(screen.getByText("Header")).toBeInTheDocument();
  });

  it("renders the error slot and hides loading/body", () => {
    render(
      <DetailPageShell
        isError={true}
        isLoading={true}
        isEmpty={true}
        {...slots}
      />,
    );

    expect(screen.getByText("Error happened")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(screen.queryByText("Nothing here")).not.toBeInTheDocument();
    expect(screen.queryByText("Body content")).not.toBeInTheDocument();
  });

  it("renders the empty slot when loaded with no items", () => {
    render(
      <DetailPageShell
        isError={false}
        isLoading={false}
        isEmpty={true}
        {...slots}
      />,
    );

    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.queryByText("Body content")).not.toBeInTheDocument();
  });

  it("always renders the background and overlays", () => {
    render(
      <DetailPageShell
        isError={false}
        isLoading={false}
        isEmpty={false}
        background={<div>Background</div>}
        overlays={<div>Overlay</div>}
      />,
    );

    expect(screen.getByText("Background")).toBeInTheDocument();
    expect(screen.getByText("Overlay")).toBeInTheDocument();
  });
});

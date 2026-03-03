import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { useRouteAnnouncer } from "./useRouteAnnouncer";

function wrapper(path: string) {
  return ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: [path] }, children);
}

describe("useRouteAnnouncer", () => {
  it("sets document.title for Home route", () => {
    renderHook(() => useRouteAnnouncer(), { wrapper: wrapper("/") });
    expect(document.title).toBe("Home - Prexu");
  });

  it("sets document.title for History route", () => {
    renderHook(() => useRouteAnnouncer(), { wrapper: wrapper("/history") });
    expect(document.title).toBe("Watch History - Prexu");
  });

  it("sets document.title for Settings route", () => {
    renderHook(() => useRouteAnnouncer(), { wrapper: wrapper("/settings") });
    expect(document.title).toBe("Settings - Prexu");
  });

  it("sets document.title for Search route", () => {
    renderHook(() => useRouteAnnouncer(), { wrapper: wrapper("/search") });
    expect(document.title).toBe("Search Results - Prexu");
  });

  it("sets document.title for Login route", () => {
    renderHook(() => useRouteAnnouncer(), { wrapper: wrapper("/login") });
    expect(document.title).toBe("Sign In - Prexu");
  });

  it("falls back to Prexu for unknown routes", () => {
    renderHook(() => useRouteAnnouncer(), {
      wrapper: wrapper("/unknown/route"),
    });
    expect(document.title).toBe("Prexu - Prexu");
  });

  it("creates aria-live region in the DOM", () => {
    renderHook(() => useRouteAnnouncer(), { wrapper: wrapper("/") });
    const liveRegion = document.getElementById("a11y-live-region");
    expect(liveRegion).not.toBeNull();
    expect(liveRegion?.getAttribute("aria-live")).toBe("polite");
  });

  it("handles library prefix route", () => {
    renderHook(() => useRouteAnnouncer(), {
      wrapper: wrapper("/library/123"),
    });
    expect(document.title).toBe("Library - Prexu");
  });

  it("handles item prefix route", () => {
    renderHook(() => useRouteAnnouncer(), {
      wrapper: wrapper("/item/456"),
    });
    expect(document.title).toBe("Details - Prexu");
  });
});

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePictureInPicture } from "./usePictureInPicture";

afterEach(() => vi.restoreAllMocks());

function standardSupport(enabled = true) {
  vi.spyOn(document, "pictureInPictureEnabled", "get").mockReturnValue(enabled);
}

// jsdom has no PiP implementation; define only this test's browser surface.
Object.defineProperty(document, "pictureInPictureEnabled", { configurable: true, get: () => false });

describe("usePictureInPicture", () => {
  it("toggles standard PiP using events as the source of truth", async () => {
    standardSupport();
    const video = document.createElement("video");
    video.requestPictureInPicture = vi.fn().mockResolvedValue({});
    document.exitPictureInPicture = vi.fn().mockResolvedValue(undefined);
    const ref = { current: video };
    const { result, unmount } = renderHook(() => usePictureInPicture(ref));
    expect(result.current.isPiPSupported).toBe(true);
    await act(() => result.current.togglePiP());
    expect(video.requestPictureInPicture).toHaveBeenCalledOnce();
    expect(result.current.isPiPActive).toBe(false);
    act(() => video.dispatchEvent(new Event("enterpictureinpicture")));
    expect(result.current.isPiPActive).toBe(true);
    Object.defineProperty(document, "pictureInPictureElement", { configurable: true, get: () => video });
    await act(() => result.current.togglePiP());
    expect(document.exitPictureInPicture).toHaveBeenCalledOnce();
    act(() => video.dispatchEvent(new Event("leavepictureinpicture")));
    expect(result.current.isPiPActive).toBe(false);
    unmount();
    Object.defineProperty(document, "pictureInPictureElement", { configurable: true, get: () => null });
  });

  it("detects WebKit support after metadata and toggles presentation mode", async () => {
    const video = Object.assign(document.createElement("video"), {
      webkitPresentationMode: "inline",
      webkitSupportsPresentationMode: vi.fn(() => false),
      webkitSetPresentationMode: vi.fn(),
    });
    const ref = { current: video };
    const { result, unmount } = renderHook(() => usePictureInPicture(ref));
    expect(result.current.isPiPSupported).toBe(false);
    video.webkitSupportsPresentationMode.mockReturnValue(true);
    act(() => video.dispatchEvent(new Event("loadedmetadata")));
    expect(result.current.isPiPSupported).toBe(true);
    await act(() => result.current.togglePiP());
    expect(video.webkitSetPresentationMode).toHaveBeenLastCalledWith("picture-in-picture");
    act(() => {
      video.webkitPresentationMode = "picture-in-picture";
      video.dispatchEvent(new Event("webkitpresentationmodechanged"));
    });
    expect(result.current.isPiPActive).toBe(true);
    await act(() => result.current.togglePiP());
    expect(video.webkitSetPresentationMode).toHaveBeenLastCalledWith("inline");
    act(() => {
      video.webkitPresentationMode = "fullscreen";
      video.dispatchEvent(new Event("webkitpresentationmodechanged"));
    });
    expect(result.current.isPiPActive).toBe(false);
    const remove = vi.spyOn(video, "removeEventListener");
    unmount();
    for (const event of ["enterpictureinpicture", "leavepictureinpicture", "webkitpresentationmodechanged", "loadedmetadata", "emptied"]) {
      expect(remove).toHaveBeenCalledWith(event, expect.any(Function));
    }
  });

  it("does not activate on rejected requests or disabled standard support", async () => {
    const video = document.createElement("video");
    video.requestPictureInPicture = vi.fn().mockRejectedValue(new Error("denied"));
    const ref = { current: video };
    const { result } = renderHook(() => usePictureInPicture(ref));
    expect(result.current.isPiPSupported).toBe(false);
    await act(() => result.current.togglePiP());
    expect(video.requestPictureInPicture).not.toHaveBeenCalled();
    standardSupport();
    await act(() => result.current.togglePiP());
    expect(video.requestPictureInPicture).toHaveBeenCalledOnce();
    expect(result.current.isPiPActive).toBe(false);
  });
});

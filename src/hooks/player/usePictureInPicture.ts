/** Browser PiP lifecycle, including WebKit's presentation-mode API. */
import { useState, useEffect, useCallback, type RefObject } from "react";

type PresentationMode = "inline" | "picture-in-picture" | "fullscreen";
interface WebKitVideoElement extends HTMLVideoElement {
  webkitPresentationMode?: PresentationMode;
  webkitSupportsPresentationMode?: (mode: PresentationMode) => boolean;
  webkitSetPresentationMode?: (mode: PresentationMode) => void;
}

function supportsStandardPiP(video: HTMLVideoElement): boolean {
  return document.pictureInPictureEnabled === true &&
    typeof video.requestPictureInPicture === "function";
}

function supportsWebKitPiP(video: WebKitVideoElement): boolean {
  return typeof video.webkitSetPresentationMode === "function" &&
    video.webkitSupportsPresentationMode?.("picture-in-picture") === true;
}

export function usePictureInPicture(videoRef: RefObject<HTMLVideoElement | null>) {
  const [isPiPActive, setIsPiPActive] = useState(false);
  const [isPiPSupported, setIsPiPSupported] = useState(false);

  useEffect(() => {
    const video = videoRef.current as WebKitVideoElement | null;
    if (!video) return;

    const handleEnter = () => setIsPiPActive(true);
    const handleLeave = () => setIsPiPActive(false);
    const handlePresentationMode = () =>
      setIsPiPActive(video.webkitPresentationMode === "picture-in-picture");
    // WebKit support can be false until metadata identifies a video track.
    const updateSupport = () =>
      setIsPiPSupported(supportsStandardPiP(video) || supportsWebKitPiP(video));

    updateSupport();
    setIsPiPActive(document.pictureInPictureElement === video ||
      video.webkitPresentationMode === "picture-in-picture");
    video.addEventListener("enterpictureinpicture", handleEnter);
    video.addEventListener("leavepictureinpicture", handleLeave);
    video.addEventListener("webkitpresentationmodechanged", handlePresentationMode);
    video.addEventListener("loadedmetadata", updateSupport);
    video.addEventListener("emptied", updateSupport);
    return () => {
      video.removeEventListener("enterpictureinpicture", handleEnter);
      video.removeEventListener("leavepictureinpicture", handleLeave);
      video.removeEventListener("webkitpresentationmodechanged", handlePresentationMode);
      video.removeEventListener("loadedmetadata", updateSupport);
      video.removeEventListener("emptied", updateSupport);
    };
  }, [videoRef]);

  const togglePiP = useCallback(async () => {
    const video = videoRef.current as WebKitVideoElement | null;
    if (!video) return;
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
      } else if (video.webkitPresentationMode === "picture-in-picture") {
        video.webkitSetPresentationMode?.("inline");
      } else if (supportsStandardPiP(video)) {
        await video.requestPictureInPicture();
      } else if (supportsWebKitPiP(video)) {
        video.webkitSetPresentationMode?.("picture-in-picture");
      }
    } catch {
      // A denied request must not change the shell; browser events own state.
    }
  }, [videoRef]);

  return { isPiPActive, isPiPSupported, togglePiP };
}

/**
 * Picture-in-Picture hook — manages PiP state and provides
 * a toggle function for video elements.
 */

import { useState, useEffect, useCallback, type RefObject } from "react";

interface UsePictureInPictureResult {
  /** Whether PiP is currently active */
  isPiPActive: boolean;
  /** Whether PiP is supported by the browser */
  isPiPSupported: boolean;
  /** Toggle PiP on/off for the video element */
  togglePiP: () => void;
}

export function usePictureInPicture(
  videoRef: RefObject<HTMLVideoElement | null>,
): UsePictureInPictureResult {
  const [isPiPActive, setIsPiPActive] = useState(false);
  const [isPiPSupported] = useState(
    () => typeof document !== "undefined" && "pictureInPictureEnabled" in document,
  );

  // Listen for PiP events on the video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleEnter = () => setIsPiPActive(true);
    const handleLeave = () => setIsPiPActive(false);

    video.addEventListener("enterpictureinpicture", handleEnter);
    video.addEventListener("leavepictureinpicture", handleLeave);

    return () => {
      video.removeEventListener("enterpictureinpicture", handleEnter);
      video.removeEventListener("leavepictureinpicture", handleLeave);
    };
  }, [videoRef]);

  const togglePiP = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !isPiPSupported) return;

    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {
      // PiP request can fail if user gesture is required or video isn't ready
    }
  }, [videoRef, isPiPSupported]);

  return { isPiPActive, isPiPSupported, togglePiP };
}

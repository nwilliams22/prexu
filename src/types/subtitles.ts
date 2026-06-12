export interface ExternalSubtitle {
  id: string;
  key: string;
  fileName: string;
  language: string;
  format: string;          // "srt", "ass", "vtt"
  hearingImpaired: boolean;
  /** 0-1, or null when the server returned no score */
  matchConfidence: number | null;
  provider: string;         // "opensubtitles", etc.
}

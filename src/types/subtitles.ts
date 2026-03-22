export interface ExternalSubtitle {
  id: string;
  key: string;
  fileName: string;
  language: string;
  format: string;          // "srt", "ass", "vtt"
  hearingImpaired: boolean;
  matchConfidence: number;  // 0-1
  provider: string;         // "opensubtitles", etc.
}

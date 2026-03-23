export type DownloadStatus =
  | "queued"
  | "downloading"
  | "complete"
  | "error"
  | "cancelled";

export interface DownloadItem {
  ratingKey: string;
  title: string;
  /** Year for movies, "S01E03" for episodes */
  subtitle: string;
  type: "movie" | "episode";
  thumb: string;
  partKey: string;
  fileName: string;
  /** File size in bytes */
  fileSize: number;
  serverUri: string;
  // State
  status: DownloadStatus;
  bytesDownloaded: number;
  errorMessage?: string;
  /** Epoch ms when download completed */
  completedAt?: number;
  // Episode metadata
  grandparentTitle?: string;
  parentIndex?: number;
  index?: number;
}

export interface DownloadProgressEvent {
  ratingKey: string;
  bytesDownloaded: number;
  totalBytes: number;
  status: string;
  errorMessage?: string;
}

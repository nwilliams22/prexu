export type ToastVariant = "success" | "error" | "info";

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
  /** Auto-dismiss duration in ms. Default 3000. Set 0 to disable auto-dismiss. */
  duration: number;
}

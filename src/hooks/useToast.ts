import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import type { Toast, ToastVariant } from "../types/toast";

const MAX_TOASTS = 5;
const DEFAULT_DURATION = 3000;

export interface ToastContextValue {
  toasts: Toast[];
  toast: (message: string, variant?: ToastVariant, duration?: number) => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider = ToastContext.Provider;

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}

export function useToastState(): ToastContextValue {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Clean up all timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
    for (const timer of timersRef.current.values()) {
      clearTimeout(timer);
    }
    timersRef.current.clear();
  }, []);

  const addToast = useCallback(
    (message: string, variant: ToastVariant = "info", duration: number = DEFAULT_DURATION) => {
      const id = crypto.randomUUID();
      const newToast: Toast = { id, message, variant, duration };

      setToasts((prev) => {
        // Evict oldest if at max
        const next = prev.length >= MAX_TOASTS ? prev.slice(1) : prev;
        return [...next, newToast];
      });

      if (duration > 0) {
        const timer = setTimeout(() => {
          dismiss(id);
        }, duration);
        timersRef.current.set(id, timer);
      }
    },
    [dismiss],
  );

  return { toasts, toast: addToast, dismiss, dismissAll };
}

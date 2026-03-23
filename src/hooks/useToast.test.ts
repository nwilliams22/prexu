import { renderHook, act } from "@testing-library/react";
import { useToastState } from "./useToast";

describe("useToastState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with an empty toast list", () => {
    const { result } = renderHook(() => useToastState());
    expect(result.current.toasts).toEqual([]);
  });

  it("adds a toast with default variant and duration", () => {
    const { result } = renderHook(() => useToastState());

    act(() => {
      result.current.toast("Hello");
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe("Hello");
    expect(result.current.toasts[0].variant).toBe("info");
    expect(result.current.toasts[0].duration).toBe(3000);
  });

  it("adds a toast with specified variant", () => {
    const { result } = renderHook(() => useToastState());

    act(() => {
      result.current.toast("Success!", "success");
    });

    expect(result.current.toasts[0].variant).toBe("success");
  });

  it("auto-dismisses after duration", () => {
    const { result } = renderHook(() => useToastState());

    act(() => {
      result.current.toast("Bye", "info", 1000);
    });

    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it("dismisses a specific toast by id", () => {
    const { result } = renderHook(() => useToastState());

    act(() => {
      result.current.toast("One", "info", 0);
      result.current.toast("Two", "info", 0);
    });

    expect(result.current.toasts).toHaveLength(2);
    const idToRemove = result.current.toasts[0].id;

    act(() => {
      result.current.dismiss(idToRemove);
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe("Two");
  });

  it("dismissAll clears all toasts", () => {
    const { result } = renderHook(() => useToastState());

    act(() => {
      result.current.toast("One", "info", 0);
      result.current.toast("Two", "info", 0);
      result.current.toast("Three", "info", 0);
    });

    expect(result.current.toasts).toHaveLength(3);

    act(() => {
      result.current.dismissAll();
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it("evicts oldest toast when max stack (5) is exceeded", () => {
    const { result } = renderHook(() => useToastState());

    act(() => {
      for (let i = 0; i < 6; i++) {
        result.current.toast(`Toast ${i}`, "info", 0);
      }
    });

    expect(result.current.toasts).toHaveLength(5);
    expect(result.current.toasts[0].message).toBe("Toast 1");
    expect(result.current.toasts[4].message).toBe("Toast 5");
  });

  it("does not auto-dismiss when duration is 0", () => {
    const { result } = renderHook(() => useToastState());

    act(() => {
      result.current.toast("Persistent", "info", 0);
    });

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(result.current.toasts).toHaveLength(1);
  });
});

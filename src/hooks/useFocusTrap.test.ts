import { renderHook } from "@testing-library/react";
import { useFocusTrap } from "./useFocusTrap";

function createContainer(...buttons: string[]) {
  const div = document.createElement("div");
  buttons.forEach((label) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    div.appendChild(btn);
  });
  document.body.appendChild(div);
  return div;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useFocusTrap", () => {
  it("focuses the first focusable element when enabled", async () => {
    const container = createContainer("A", "B", "C");
    const ref = { current: container };

    renderHook(() => useFocusTrap(ref, true));

    // useFocusTrap uses requestAnimationFrame
    await new Promise((r) => requestAnimationFrame(r));

    expect(document.activeElement).toBe(container.querySelector("button"));
  });

  it("does not move focus when disabled", async () => {
    const container = createContainer("A", "B");
    const ref = { current: container };
    const outside = document.createElement("button");
    outside.textContent = "Outside";
    document.body.appendChild(outside);
    outside.focus();

    renderHook(() => useFocusTrap(ref, false));
    await new Promise((r) => requestAnimationFrame(r));

    expect(document.activeElement).toBe(outside);
  });

  it("wraps focus from last to first on Tab", async () => {
    const container = createContainer("First", "Last");
    const ref = { current: container };
    const buttons = container.querySelectorAll("button");

    renderHook(() => useFocusTrap(ref, true));
    await new Promise((r) => requestAnimationFrame(r));

    // Focus the last button
    buttons[1].focus();
    expect(document.activeElement).toBe(buttons[1]);

    // Press Tab on the last element — should wrap to first
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(document.activeElement).toBe(buttons[0]);
  });

  it("wraps focus from first to last on Shift+Tab", async () => {
    const container = createContainer("First", "Last");
    const ref = { current: container };
    const buttons = container.querySelectorAll("button");

    renderHook(() => useFocusTrap(ref, true));
    await new Promise((r) => requestAnimationFrame(r));

    // Focus the first button
    buttons[0].focus();

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(document.activeElement).toBe(buttons[1]);
  });

  it("restores focus on unmount", async () => {
    const outside = document.createElement("button");
    outside.textContent = "Outside";
    document.body.appendChild(outside);
    outside.focus();

    const container = createContainer("Inside");
    const ref = { current: container };

    const { unmount } = renderHook(() => useFocusTrap(ref, true));
    await new Promise((r) => requestAnimationFrame(r));

    expect(document.activeElement).toBe(container.querySelector("button"));

    unmount();
    expect(document.activeElement).toBe(outside);
  });

  it("skips disabled buttons", async () => {
    const container = document.createElement("div");
    const disabled = document.createElement("button");
    disabled.disabled = true;
    disabled.textContent = "Disabled";
    const enabled = document.createElement("button");
    enabled.textContent = "Enabled";
    container.appendChild(disabled);
    container.appendChild(enabled);
    document.body.appendChild(container);

    const ref = { current: container };

    renderHook(() => useFocusTrap(ref, true));
    await new Promise((r) => requestAnimationFrame(r));

    expect(document.activeElement).toBe(enabled);
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ControlsOverflowMenu, {
  type ControlsOverflowItem,
} from "./ControlsOverflowMenu";

function makeItems(overrides?: Partial<ControlsOverflowItem>[]): {
  items: ControlsOverflowItem[];
  onClick: ReturnType<typeof vi.fn>;
} {
  const onClick = vi.fn();
  const items: ControlsOverflowItem[] = [
    { key: "audio", label: "Audio", icon: <span>a</span>, onClick },
    { key: "queue", label: "Playback queue", icon: <span>q</span>, onClick: vi.fn(), badge: 3 },
    { key: "minimize", label: "Minimize player to corner", icon: <span>m</span>, onClick: vi.fn(), active: true },
  ];
  if (overrides) {
    overrides.forEach((o, i) => Object.assign(items[i], o));
  }
  return { items, onClick };
}

describe("ControlsOverflowMenu (prexu-52ky)", () => {
  it("renders every provided item with its label", () => {
    const { items } = makeItems();
    render(<ControlsOverflowMenu items={items} onClose={vi.fn()} />);
    expect(screen.getByRole("menu", { name: "More controls" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Audio/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Playback queue/ })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Minimize player to corner/ })).toBeTruthy();
  });

  it("shows a badge when provided and > 0", () => {
    const { items } = makeItems();
    render(<ControlsOverflowMenu items={items} onClose={vi.fn()} />);
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("omits the badge when it is 0 or undefined", () => {
    const { items } = makeItems([{}, { badge: 0 }, {}]);
    render(<ControlsOverflowMenu items={items} onClose={vi.fn()} />);
    expect(screen.queryByText("0")).toBeNull();
  });

  it("invokes the item's onClick and then closes the menu on click", () => {
    const onClose = vi.fn();
    const { items, onClick } = makeItems();
    render(<ControlsOverflowMenu items={items} onClose={onClose} />);
    fireEvent.click(screen.getByRole("menuitem", { name: /Audio/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    const { items } = makeItems();
    render(<ControlsOverflowMenu items={items} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on backdrop click but not on menu-body click", () => {
    const onClose = vi.fn();
    const { items } = makeItems();
    const { container } = render(
      <ControlsOverflowMenu items={items} onClose={onClose} />,
    );
    // Menu body click (stopPropagation) must NOT close.
    fireEvent.click(screen.getByRole("menu"));
    expect(onClose).not.toHaveBeenCalled();
    // Backdrop (outer div) click must close.
    const backdrop = container.firstElementChild as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

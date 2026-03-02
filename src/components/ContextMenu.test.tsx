import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContextMenu from "./ContextMenu";

describe("ContextMenu", () => {
  const defaultItems = [
    { label: "Play", onClick: vi.fn() },
    { label: "Add to Queue", onClick: vi.fn() },
    { label: "Delete", onClick: vi.fn(), disabled: true },
  ];
  const defaultPosition = { x: 100, y: 200 };
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    defaultItems.forEach((item) => (item.onClick as ReturnType<typeof vi.fn>).mockClear());
  });

  it("renders all menu items", () => {
    render(
      <ContextMenu items={defaultItems} position={defaultPosition} onClose={onClose} />
    );

    expect(screen.getByText("Play")).toBeInTheDocument();
    expect(screen.getByText("Add to Queue")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("calls onClick and onClose when a menu item is clicked", async () => {
    const user = userEvent.setup();

    render(
      <ContextMenu items={defaultItems} position={defaultPosition} onClose={onClose} />
    );

    await user.click(screen.getByText("Play"));

    expect(defaultItems[0].onClick).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClick for disabled items", async () => {
    const user = userEvent.setup();

    render(
      <ContextMenu items={defaultItems} position={defaultPosition} onClose={onClose} />
    );

    await user.click(screen.getByText("Delete"));

    expect(defaultItems[2].onClick).not.toHaveBeenCalled();
  });

  it("renders divider when dividerAbove is true", () => {
    const items = [
      { label: "Play", onClick: vi.fn() },
      { label: "Delete", onClick: vi.fn(), dividerAbove: true },
    ];

    const { container } = render(
      <ContextMenu items={items} position={defaultPosition} onClose={onClose} />
    );

    // Divider should be present (1px height element)
    const dividers = container.querySelectorAll("[style*='height: 1px']");
    expect(dividers.length).toBeGreaterThanOrEqual(1);
  });

  it("closes on Escape key", () => {
    render(
      <ContextMenu items={defaultItems} position={defaultPosition} onClose={onClose} />
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("positions the menu at the specified coordinates", () => {
    const { container } = render(
      <ContextMenu
        items={defaultItems}
        position={{ x: 150, y: 250 }}
        onClose={onClose}
      />
    );

    const menu = container.firstChild as HTMLElement;
    expect(menu.style.left).toBe("150px");
    expect(menu.style.top).toBe("250px");
  });

  it("sets disabled attribute on disabled items", () => {
    render(
      <ContextMenu items={defaultItems} position={defaultPosition} onClose={onClose} />
    );

    const deleteButton = screen.getByText("Delete").closest("button");
    expect(deleteButton).toBeDisabled();
  });
});

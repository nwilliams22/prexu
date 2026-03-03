import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import ContextMenu from "./ContextMenu";

describe("ContextMenu a11y", () => {
  const items = [
    { label: "Play", onClick: vi.fn() },
    { label: "Add to Queue", onClick: vi.fn() },
  ];
  const position = { x: 100, y: 200 };
  const onClose = vi.fn();

  it("has no axe violations", async () => {
    const { container } = render(
      <ContextMenu items={items} position={position} onClose={onClose} />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has menu role on container", () => {
    const { container } = render(
      <ContextMenu items={items} position={position} onClose={onClose} />
    );
    expect(container.querySelector("[role='menu']")).not.toBeNull();
  });

  it("has menuitem role on each option", () => {
    render(
      <ContextMenu items={items} position={position} onClose={onClose} />
    );
    const menuItems = screen.getAllByRole("menuitem");
    expect(menuItems).toHaveLength(2);
  });
});

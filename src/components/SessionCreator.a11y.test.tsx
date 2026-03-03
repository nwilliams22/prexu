import { render } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { axe } from "vitest-axe";
import SessionCreator from "./SessionCreator";

// Mock the hooks used by SessionCreator
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    authToken: "auth-token",
    server: {
      uri: "http://localhost:32400",
      accessToken: "token",
    },
    activeUser: {
      username: "alice",
    },
  }),
}));

vi.mock("../services/plex-library", () => ({
  getPlexFriends: vi.fn().mockResolvedValue([]),
}));

function renderSessionCreator(props = {}) {
  const defaultProps = {
    ratingKey: "123",
    title: "Test Movie",
    mediaType: "movie" as const,
    onClose: vi.fn(),
    ...props,
  };
  return render(
    <BrowserRouter>
      <SessionCreator {...defaultProps} />
    </BrowserRouter>
  );
}

describe("SessionCreator a11y", () => {
  it("has no axe violations", async () => {
    const { container } = renderSessionCreator();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has dialog role with aria-modal", () => {
    const { container } = renderSessionCreator();
    const dialog = container.querySelector("[role='dialog']");
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
  });

  it("has aria-labelledby referencing the heading", () => {
    renderSessionCreator();
    const dialog = document.querySelector("[role='dialog']");
    const labelledBy = dialog?.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const heading = document.getElementById(labelledBy!);
    expect(heading).not.toBeNull();
  });
});

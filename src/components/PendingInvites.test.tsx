import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PendingInvites from "./PendingInvites";
const navigate = vi.fn();
const dismiss = vi.fn();
vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("../hooks/useInvites", () => ({ useInvites: () => ({ dismissInvite: dismiss, invites: [{ sessionId: "AB12CD34", mediaRatingKey: "17", senderUsername: "QA host", mediaTitle: "QA Seasons", sentAt: Date.now(), relayUrl: "" }] }) }));
describe("pending invites", () => {
  it("joins a saved invite with its sender, title, and expiry visible", async () => {
    render(<PendingInvites />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Pending invites (1)"));
    expect(screen.getByText("QA host")).toBeInTheDocument();
    expect(screen.getByText("600 seconds left")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Join QA Seasons" }));
    expect(navigate).toHaveBeenCalledWith("/play/17?session=AB12CD34&relay=");
    expect(dismiss).toHaveBeenCalledWith("AB12CD34");
  });
  it("rejects foreign relay links before navigation, then joins a valid pasted link", async () => {
    navigate.mockClear();
    render(<PendingInvites />);
    const user = userEvent.setup();
    await user.click(screen.getByText("Pending invites (1)"));
    const input = screen.getByLabelText("Paste invite link");
    await user.type(input, "prexu://join/AB12CD34?media=17&relay=wss://evil.test");
    await user.click(screen.getByRole("button", { name: "Join by link" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid invite link");
    expect(navigate).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, "prexu://join/AB12CD34?media=17");
    await user.click(screen.getByRole("button", { name: "Join by link" }));
    expect(navigate).toHaveBeenCalledWith("/play/17?session=AB12CD34");
  });
});

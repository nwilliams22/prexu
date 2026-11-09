import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { ParentalControlsPanel } from "./ParentalControlsPanel";

// Mock hooks
const mockLoadForUser = vi.fn();
const mockSaveForUser = vi.fn();
const mockToast = vi.fn();

vi.mock("../../hooks/useHomeUsers", () => ({
  useHomeUsers: vi.fn(() => ({
    homeUsers: [
      {
        id: 1,
        uuid: "admin-uuid",
        title: "Admin",
        username: "admin",
        thumb: "",
        admin: true,
        guest: false,
        restricted: false,
        home: true,
        protected: false,
      },
      {
        id: 2,
        uuid: "child-uuid",
        title: "Child",
        username: "",
        thumb: "",
        admin: false,
        guest: false,
        restricted: true,
        home: true,
        protected: true,
      },
      {
        id: 3,
        uuid: "teen-uuid",
        title: "Teen",
        username: "",
        thumb: "",
        admin: false,
        guest: false,
        restricted: false,
        home: true,
        protected: false,
      },
    ],
    isPlexHome: true,
    isLoading: false,
    isSwitching: false,
    switchError: null,
    switchTo: vi.fn(),
    clearError: vi.fn(),
  })),
}));

vi.mock("../../hooks/useParentalControls", () => ({
  useParentalControls: vi.fn(() => ({
    restrictionsEnabled: false,
    maxContentRating: "none",
    filterByRating: vi.fn((items: unknown[]) => items),
    isItemAllowed: vi.fn(() => true),
    loadForUser: mockLoadForUser,
    saveForUser: mockSaveForUser,
  })),
}));

vi.mock("../../hooks/useToast", () => ({
  useToast: vi.fn(() => ({
    toast: mockToast,
    toasts: [],
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  })),
}));

describe("ParentalControlsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadForUser.mockResolvedValue({ enabled: false, maxContentRating: "PG" });
    mockSaveForUser.mockResolvedValue(undefined);
  });
  it("does not load or render restricted data for a non-admin", () => {
    render(<MemoryRouter><ParentalControlsPanel isAdmin={false} /></MemoryRouter>);
    expect(screen.getByText("Parental controls are available to administrators")).toBeVisible();
    expect(screen.queryByText("Child")).toBeNull();
    expect(mockLoadForUser).not.toHaveBeenCalled();
  });
  it("shows loading rather than unrestricted summaries until data resolves", async () => {
    mockLoadForUser.mockReturnValue(new Promise(() => {}));
    render(<ParentalControlsPanel isAdmin />);
    expect(screen.getByText("Loading managed users and restrictions…")).toBeVisible();
    expect(screen.queryByText("No restrictions")).toBeNull();
  });
  it("renders only non-admin users and keeps disabled rating visible", async () => {
    render(<ParentalControlsPanel isAdmin />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit Child" }));
    expect(screen.queryByText("Admin")).toBeNull();
    expect(screen.getByText("Protected profile")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Maximum Allowed Rating" })).toBeDisabled();
    expect(screen.getByRole("combobox")).toHaveValue("PG");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("combobox")).toHaveValue("PG");
    expect(screen.getByRole("combobox")).toBeEnabled();
  });
  it("retains a failed draft for Retry and focuses Edit after success", async () => {
    mockSaveForUser.mockRejectedValueOnce(new Error("disk"));
    render(<ParentalControlsPanel isAdmin />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit Child" }));
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save restrictions");
    expect(screen.getByRole("checkbox")).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Restrictions updated for Child")).toBeVisible();
    expect(mockSaveForUser).toHaveBeenLastCalledWith(2, { enabled: true, maxContentRating: "PG" });
    expect(screen.getByRole("button", { name: "Edit Child" })).toHaveFocus();
  });
  it("reports read failures and retries without displaying false summaries", async () => {
    mockLoadForUser.mockRejectedValueOnce(new Error("read"));
    render(<ParentalControlsPanel isAdmin />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load parental controls");
    expect(screen.queryByText("No restrictions")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Edit Child" })).toBeVisible();
  });
});

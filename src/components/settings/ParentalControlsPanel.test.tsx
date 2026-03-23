import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    mockLoadForUser.mockResolvedValue({
      enabled: false,
      maxContentRating: "none",
    });
    mockSaveForUser.mockResolvedValue(undefined);
  });

  it("renders only non-admin managed users", () => {
    render(<ParentalControlsPanel />);

    expect(screen.getByText("Child")).toBeInTheDocument();
    expect(screen.getByText("Teen")).toBeInTheDocument();
    // Admin should not appear in the list
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("shows 'No restrictions' by default", () => {
    render(<ParentalControlsPanel />);

    const noRestrictions = screen.getAllByText("No restrictions");
    expect(noRestrictions.length).toBeGreaterThanOrEqual(2);
  });

  it("opens edit form when Edit is clicked", async () => {
    render(<ParentalControlsPanel />);

    const editButtons = screen.getAllByText("Edit");
    fireEvent.click(editButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Enable content restrictions")).toBeInTheDocument();
    });
  });

  it("shows rating dropdown when restrictions enabled", async () => {
    render(<ParentalControlsPanel />);

    const editButtons = screen.getAllByText("Edit");
    fireEvent.click(editButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Enable content restrictions")).toBeInTheDocument();
    });

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);

    expect(screen.getByText("Maximum Allowed Rating")).toBeInTheDocument();
  });

  it("saves settings and shows toast", async () => {
    render(<ParentalControlsPanel />);

    const editButtons = screen.getAllByText("Edit");
    fireEvent.click(editButtons[0]);

    await waitFor(() => {
      expect(screen.getByText("Enable content restrictions")).toBeInTheDocument();
    });

    const saveButton = screen.getByText("Save");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockSaveForUser).toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        "Restrictions updated for Child",
        "success",
      );
    });
  });
});

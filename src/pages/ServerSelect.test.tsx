import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import ServerSelect from "./ServerSelect";

const mockSelectServer = vi.fn(() => Promise.resolve());
const mockLogout = vi.fn(() => Promise.resolve());
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    authToken: "test-token",
    selectServer: mockSelectServer,
    logout: mockLogout,
  }),
}));

const mockDiscoverServers = vi.fn();
vi.mock("../services/plex-api", () => ({
  discoverServers: (...args: unknown[]) => mockDiscoverServers(...args),
}));

function renderPage() {
  return render(
    <BrowserRouter>
      <ServerSelect />
    </BrowserRouter>
  );
}

const onlineServer = {
  name: "Home Server",
  clientIdentifier: "s1",
  accessToken: "st1",
  uri: "https://plex.local:32400",
  local: true,
  owned: true,
  status: "online" as const,
};

const offlineServer = {
  name: "Remote Server",
  clientIdentifier: "s2",
  accessToken: "st2",
  uri: "https://remote.plex:32400",
  local: false,
  owned: false,
  status: "offline" as const,
};

describe("ServerSelect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDiscoverServers.mockResolvedValue([onlineServer, offlineServer]);
  });

  it("renders title and subtitle", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Select a Server")).toBeInTheDocument();
    });
    expect(screen.getByText(/Choose which Plex server/)).toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    mockDiscoverServers.mockImplementation(() => new Promise(() => {}));
    renderPage();

    expect(screen.getByText("Connecting...")).toBeInTheDocument();
  });

  it("displays discovered servers", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Home Server")).toBeInTheDocument();
    });

    expect(screen.getByText("Remote Server")).toBeInTheDocument();
  });

  it("shows owned/local metadata for servers", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Home Server")).toBeInTheDocument();
    });

    expect(screen.getByText(/Owned/)).toBeInTheDocument();
    expect(screen.getByText(/Shared/)).toBeInTheDocument();
  });

  it("shows error when discovery fails", async () => {
    mockDiscoverServers.mockRejectedValue(new Error("Connection refused"));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Connection refused")).toBeInTheDocument();
    });

    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("shows empty state when no servers found", async () => {
    mockDiscoverServers.mockResolvedValue([]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("No Plex servers found on your account.")).toBeInTheDocument();
    });
  });

  it("selects an online server on click", async () => {
    renderPage();
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Home Server")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Home Server"));

    expect(mockSelectServer).toHaveBeenCalledWith(expect.objectContaining({
      name: "Home Server",
      uri: "https://plex.local:32400",
    }));
  });

  it("does not select offline server on click", async () => {
    renderPage();
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText("Remote Server")).toBeInTheDocument();
    });

    // Clear any calls from auto-select logic during initial render
    mockSelectServer.mockClear();

    await user.click(screen.getByText("Remote Server"));

    expect(mockSelectServer).not.toHaveBeenCalled();
  });

  it("auto-selects when exactly one server is online", async () => {
    mockDiscoverServers.mockResolvedValue([onlineServer]);

    renderPage();

    await waitFor(() => {
      expect(mockSelectServer).toHaveBeenCalledWith(expect.objectContaining({
        name: "Home Server",
      }));
    });
  });

  it("does not auto-select when multiple servers are online", async () => {
    const secondOnline = { ...offlineServer, status: "online" as const };
    mockDiscoverServers.mockResolvedValue([onlineServer, secondOnline]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Home Server")).toBeInTheDocument();
    });

    // selectServer should not have been called (auto-select only for single online)
    expect(mockSelectServer).not.toHaveBeenCalled();
  });

  it("calls logout when sign out button is clicked", async () => {
    renderPage();
    const user = userEvent.setup();

    await user.click(screen.getByText("Sign out"));

    expect(mockLogout).toHaveBeenCalled();
  });

  it("uses generic error for non-Error throws", async () => {
    mockDiscoverServers.mockRejectedValue("string error");

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Failed to discover servers.")).toBeInTheDocument();
    });
  });
});

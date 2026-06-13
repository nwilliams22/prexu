import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PlayBridge from "./PlayBridge";

// ── Mocks ──

const mockPlay = vi.fn();
const mockNavigate = vi.fn();

vi.mock("../contexts/PlayerContext", () => ({
  usePlayerSession: () => ({ play: mockPlay }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// LAST_NON_PLAYER_ROUTE_KEY is only used for sessionStorage — stub the import
vi.mock("../App", () => ({
  LAST_NON_PLAYER_ROUTE_KEY: "prexu_last_non_player",
}));

// ── Helpers ──

function renderWithRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/play/:ratingKey" element={<PlayBridge />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ── Tests ──

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PlayBridge relay URL validation", () => {
  it("passes a valid ws:// relay URL through to play()", () => {
    renderWithRoute("/play/12345?session=abc&relay=ws%3A%2F%2F192.168.1.100%3A9847%2Fws");
    expect(mockPlay).toHaveBeenCalledWith(
      "12345",
      expect.objectContaining({
        watchTogether: expect.objectContaining({
          relayUrl: "ws://192.168.1.100:9847/ws",
        }),
      }),
    );
  });

  it("passes a valid wss:// relay URL through to play()", () => {
    renderWithRoute("/play/12345?session=abc&relay=wss%3A%2F%2Frelay.example.com%3A9847%2Fws");
    expect(mockPlay).toHaveBeenCalledWith(
      "12345",
      expect.objectContaining({
        watchTogether: expect.objectContaining({
          relayUrl: "wss://relay.example.com:9847/ws",
        }),
      }),
    );
  });

  it("rejects an http:// relay URL (sets relayUrl to undefined)", () => {
    renderWithRoute("/play/12345?session=abc&relay=http%3A%2F%2Fattacker.example.com%2Fws");
    expect(mockPlay).toHaveBeenCalledWith(
      "12345",
      expect.objectContaining({
        watchTogether: expect.objectContaining({
          relayUrl: undefined,
        }),
      }),
    );
  });

  it("rejects a javascript: relay URL (sets relayUrl to undefined)", () => {
    renderWithRoute("/play/12345?session=abc&relay=javascript%3Aalert(1)");
    expect(mockPlay).toHaveBeenCalledWith(
      "12345",
      expect.objectContaining({
        watchTogether: expect.objectContaining({
          relayUrl: undefined,
        }),
      }),
    );
  });

  it("rejects a non-URL relay value (sets relayUrl to undefined)", () => {
    renderWithRoute("/play/12345?session=abc&relay=not-a-url");
    expect(mockPlay).toHaveBeenCalledWith(
      "12345",
      expect.objectContaining({
        watchTogether: expect.objectContaining({
          relayUrl: undefined,
        }),
      }),
    );
  });

  it("passes undefined relayUrl when relay param is absent", () => {
    renderWithRoute("/play/12345?session=abc");
    expect(mockPlay).toHaveBeenCalledWith(
      "12345",
      expect.objectContaining({
        watchTogether: expect.objectContaining({
          relayUrl: undefined,
        }),
      }),
    );
  });

  it("constructs no watchTogether when session param is absent", () => {
    renderWithRoute("/play/12345");
    expect(mockPlay).toHaveBeenCalledWith(
      "12345",
      expect.objectContaining({
        watchTogether: undefined,
      }),
    );
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { memo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ItemRow, CollectionItemsList, ROW_VIRTUALIZE_THRESHOLD } from "./CollectionDetail";
import type { ItemRowProps } from "./CollectionDetail";
import { createPlexMovie, resetIdCounter } from "../__tests__/mocks/plex-data";
import type { PlexMediaItem } from "../types/library";
import type { ItemDetail } from "../hooks/useItemDetails";

const stableServer = { uri: "https://plex.test", accessToken: "token" };
vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ server: stableServer }),
}));

vi.mock("../services/plex-library", () => ({
  getItemMetadata: vi.fn(() => Promise.resolve({})),
}));

/** Fresh QueryClient per test (retries disabled for determinism) — mirrors
 *  the pattern in useDetailItems.test.tsx. CollectionItemsList uses
 *  useItemDetails internally, which needs a QueryClientProvider ancestor. */
function withQueryClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

// ── Shared stubs ──

const noopThumbUrl = (thumb: string) => `http://img.test${thumb}`;
const noopGetPlayHandler = () => undefined;

function baseItemRowProps(overrides: Partial<ItemRowProps> = {}): ItemRowProps {
  return {
    item: createPlexMovie({ ratingKey: "1", title: "Test Movie" }),
    detail: undefined,
    isPending: false,
    mobile: false,
    thumbUrl: noopThumbUrl,
    actorThumbUrl: noopThumbUrl,
    navigate: vi.fn(),
    onContextMenu: vi.fn(),
    getPlayHandler: noopGetPlayHandler,
    ...overrides,
  };
}

beforeEach(() => {
  resetIdCounter();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ItemRow", () => {
  it("renders title, year, and duration from detail", () => {
    const detail = createPlexMovie({
      ratingKey: "1",
      year: 2011,
      duration: 8_400_000, // 2h 20m
    }) as ItemDetail;

    render(
      <MemoryRouter>
        <ItemRow {...baseItemRowProps({ detail })} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Test Movie")).toBeInTheDocument();
    expect(screen.getByText("(2011)")).toBeInTheDocument();
    expect(screen.getByText("2h 20m")).toBeInTheDocument();
  });

  it("shows the shimmer placeholder while pending with no detail yet", () => {
    const { container } = render(
      <MemoryRouter>
        <ItemRow {...baseItemRowProps({ detail: undefined, isPending: true })} />
      </MemoryRouter>,
    );
    expect(container.querySelector(".shimmer")).toBeInTheDocument();
  });

  it("does not show the shimmer once detail has loaded", () => {
    const detail = createPlexMovie({ ratingKey: "1" }) as ItemDetail;
    const { container } = render(
      <MemoryRouter>
        <ItemRow {...baseItemRowProps({ detail, isPending: false })} />
      </MemoryRouter>,
    );
    expect(container.querySelector(".shimmer")).not.toBeInTheDocument();
  });

  it("navigates to the item on row click", () => {
    const navigate = vi.fn();
    render(
      <MemoryRouter>
        <ItemRow {...baseItemRowProps({ navigate })} />
      </MemoryRouter>,
    );
    screen.getByText("Test Movie").click();
    expect(navigate).toHaveBeenCalledWith("/item/1");
  });

  it("hides the play button on mobile", () => {
    render(
      <MemoryRouter>
        <ItemRow {...baseItemRowProps({ mobile: true })} />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText("Play Test Movie")).not.toBeInTheDocument();
  });

  // prexu-0szx.6: memo regression test. Every row-list consumer (
  // CollectionItemsList) must hand ItemRow the SAME `detail` object
  // reference, the SAME callback references, etc. across renders that
  // don't actually change that row's data — otherwise memo never skips
  // and the O(n^2) re-render cascade the audit flagged comes right back.
  it("memo skips re-render when the parent re-renders with equivalent (but freshly-passed) props", () => {
    let renderCount = 0;
    const CountingItemRow = memo(function CountingItemRow(props: ItemRowProps) {
      renderCount++;
      return <ItemRow {...props} />;
    });

    const stableProps = baseItemRowProps();

    function Harness({ tick }: { tick: number }) {
      // A parent re-render (tick changes) must NOT create new prop
      // identities for the row — this mirrors CollectionItemsList, which
      // reads `detail` from a stable Map and passes down memoized
      // navigate/onContextMenu/getPlayHandler callbacks.
      void tick;
      return (
        <MemoryRouter>
          <CountingItemRow {...stableProps} />
        </MemoryRouter>
      );
    }

    const { rerender } = render(<Harness tick={0} />);
    expect(renderCount).toBe(1);

    // Parent re-renders (e.g. an unrelated sibling row's detail resolved)
    // with the exact same prop object — memo must skip.
    rerender(<Harness tick={1} />);
    expect(renderCount).toBe(1);

    rerender(<Harness tick={2} />);
    expect(renderCount).toBe(1);

    // Sanity check: changing an actual prop DOES re-render.
    rerender(
      <MemoryRouter>
        <CountingItemRow {...stableProps} isPending={!stableProps.isPending} />
      </MemoryRouter>,
    );
    expect(renderCount).toBe(2);
  });
});

describe("CollectionItemsList", () => {
  function makeItems(count: number): PlexMediaItem[] {
    return Array.from({ length: count }, (_, i) =>
      createPlexMovie({ ratingKey: String(i + 1), title: `Movie ${i + 1}` }),
    );
  }

  const listProps = {
    mobile: false,
    navigate: vi.fn(),
    onContextMenu: vi.fn(),
    getPlayHandler: noopGetPlayHandler,
    thumbUrl: noopThumbUrl,
    actorThumbUrl: noopThumbUrl,
  };

  it("renders every row when below the virtualize threshold (plain list path)", () => {
    const items = makeItems(5);
    render(withQueryClient(<CollectionItemsList items={items} {...listProps} />));
    for (const item of items) {
      expect(screen.getByText(item.title)).toBeInTheDocument();
    }
  });

  it("bounds mounted rows well below the total item count once virtualized", () => {
    // Give the virtualizer a non-zero viewport so it computes a real
    // (bounded) visible window instead of jsdom's default 0-height,
    // 0-item range. @tanstack/react-virtual measures the scroll element via
    // offsetWidth/offsetHeight (not getBoundingClientRect), both always 0 in
    // jsdom by default — override them so the virtualizer computes a real,
    // bounded visible window instead of an empty one.
    const widthSpy = vi
      .spyOn(HTMLElement.prototype, "offsetWidth", "get")
      .mockReturnValue(1000);
    const heightSpy = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockReturnValue(800);

    const total = ROW_VIRTUALIZE_THRESHOLD + 100;
    const items = makeItems(total);

    render(withQueryClient(<CollectionItemsList items={items} {...listProps} />));

    // A handful of rows near the top should be mounted...
    expect(screen.getByText("Movie 1")).toBeInTheDocument();
    // ...but nowhere near all `total` rows — that's the whole point of
    // virtualizing a 150+ item collection.
    const mountedTitles = screen.getAllByText(/^Movie \d+$/);
    expect(mountedTitles.length).toBeGreaterThan(0);
    expect(mountedTitles.length).toBeLessThan(total / 2);

    widthSpy.mockRestore();
    heightSpy.mockRestore();
  });
});

import { describe, it, expect } from "vitest";
import { getAgentForType } from "./plex-match";

describe("getAgentForType", () => {
  it('returns movie agent for "movie"', () => {
    expect(getAgentForType("movie")).toBe("tv.plex.agents.movie");
  });

  it('returns series agent for "show"', () => {
    expect(getAgentForType("show")).toBe("tv.plex.agents.series");
  });

  it('returns series agent for "episode"', () => {
    expect(getAgentForType("episode")).toBe("tv.plex.agents.series");
  });

  it('returns series agent for "season"', () => {
    expect(getAgentForType("season")).toBe("tv.plex.agents.series");
  });

  it("returns movie agent as default for unknown type", () => {
    expect(getAgentForType("unknown")).toBe("tv.plex.agents.movie");
  });
});

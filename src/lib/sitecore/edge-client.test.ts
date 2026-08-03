import { describe, expect, it } from "vitest";
import { edgeEndpoint, isLikelyLiveEdgeHost } from "./edge-client";

describe("edgeEndpoint", () => {
  it("targets the CM host's preview endpoint", () => {
    expect(
      edgeEndpoint({
        name: "Dev",
        host: "https://xmc-org-project-dev.sitecorecloud.io",
      }),
    ).toBe(
      "https://xmc-org-project-dev.sitecorecloud.io/sitecore/api/graph/edge",
    );
  });
});

describe("isLikelyLiveEdgeHost", () => {
  it("flags Experience Edge delivery hosts", () => {
    expect(isLikelyLiveEdgeHost("https://edge.sitecorecloud.io")).toBe(true);
    expect(isLikelyLiveEdgeHost("https://edge-platform.sitecorecloud.io")).toBe(
      true,
    );
  });

  it("does not flag ordinary CM hosts", () => {
    expect(
      isLikelyLiveEdgeHost("https://xmc-org-project-dev.sitecorecloud.io"),
    ).toBe(false);
    expect(isLikelyLiveEdgeHost("https://cm.example.com")).toBe(false);
  });

  it("does not flag a CM host that merely contains the word edge", () => {
    expect(
      isLikelyLiveEdgeHost("https://xmc-edgecase-project-dev.sitecorecloud.io"),
    ).toBe(false);
  });
});

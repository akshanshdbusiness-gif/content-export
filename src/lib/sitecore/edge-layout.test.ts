import { describe, expect, it } from "vitest";
import {
  flattenPlaceholders,
  normalizeFieldValue,
  siteNameFromPath,
  sitecorePathToRoute,
} from "./edge-layout";

describe("siteNameFromPath", () => {
  it("takes the segment before /Home", () => {
    expect(
      siteNameFromPath("/sitecore/content/acme/acme-us/Home/about"),
    ).toBe("acme-us");
  });

  it("works when the page is the home node itself", () => {
    expect(siteNameFromPath("/sitecore/content/acme/acme-us/Home")).toBe(
      "acme-us",
    );
  });

  it("is case-insensitive about the Home node", () => {
    expect(siteNameFromPath("/sitecore/content/org/site/home/news")).toBe(
      "site",
    );
  });

  it("falls back to the site root when there is no /Home", () => {
    expect(siteNameFromPath("/sitecore/content/org/site/Landing")).toBe("site");
    expect(siteNameFromPath("/sitecore/content/MySite")).toBe("MySite");
  });

  it("returns undefined outside /sitecore/content", () => {
    expect(siteNameFromPath("/sitecore/media library/Images")).toBeUndefined();
  });
});

describe("sitecorePathToRoute", () => {
  it("maps the home node to /", () => {
    expect(sitecorePathToRoute("/sitecore/content/org/site/Home")).toBe("/");
  });

  it("maps a child page to its route", () => {
    expect(sitecorePathToRoute("/sitecore/content/org/site/Home/about")).toBe(
      "/about",
    );
  });

  it("keeps nested routes", () => {
    expect(
      sitecorePathToRoute("/sitecore/content/org/site/Home/news/2024/launch"),
    ).toBe("/news/2024/launch");
  });

  it("handles paths without a /Home node", () => {
    expect(sitecorePathToRoute("/sitecore/content/org/site/landing")).toBe(
      "/landing",
    );
  });
});

describe("normalizeFieldValue", () => {
  it("unwraps simple { value } fields", () => {
    expect(normalizeFieldValue({ value: "About Acme" })).toBe("About Acme");
  });

  it("keeps image objects as nested objects", () => {
    expect(
      normalizeFieldValue({
        value: { src: "https://cdn/x.jpg", alt: "About", width: "1200" },
      }),
    ).toEqual({ src: "https://cdn/x.jpg", alt: "About", width: "1200" });
  });

  it("drops layout-service editable markup", () => {
    expect(
      normalizeFieldValue({ value: "Text", editable: "<span>Text</span>" }),
    ).toBe("Text");
  });

  it("flattens content-list items alongside their identity", () => {
    const result = normalizeFieldValue([
      {
        id: "29C99ECD",
        name: "aurora",
        fields: {
          title: { value: "Aurora" },
          cta: { value: { href: "https://x/aurora", text: "Learn More" } },
        },
      },
    ]);
    expect(result).toEqual([
      {
        id: "29C99ECD",
        name: "aurora",
        title: "Aurora",
        cta: { href: "https://x/aurora", text: "Learn More" },
      },
    ]);
  });

  it("returns null for missing values", () => {
    expect(normalizeFieldValue(undefined)).toBeNull();
    expect(normalizeFieldValue({ value: null })).toBeNull();
  });

  it("stops recursing on pathologically deep input", () => {
    let deep: Record<string, unknown> = { value: "bottom" };
    for (let i = 0; i < 50; i++) deep = { nested: deep };
    expect(() => normalizeFieldValue(deep)).not.toThrow();
  });
});

describe("flattenPlaceholders", () => {
  const placeholders = {
    "headless-header": [{ uid: "h1", componentName: "Header", fields: {} }],
    "headless-main": [
      {
        uid: "c1",
        componentName: "CardGrid",
        dataSource: "/sitecore/content/org/site/Data/Cards",
        params: { GridParameters: "col-12" },
        fields: { sectionTitle: { value: "Brands" } },
        placeholders: {
          "card-inner": [{ uid: "c2", componentName: "Card", fields: {} }],
        },
      },
    ],
  };

  it("flattens nested placeholders and records their keys", () => {
    const components = flattenPlaceholders(placeholders);
    expect(components.map((c) => c.type)).toEqual([
      "Header",
      "CardGrid",
      "Card",
    ]);
    expect(components[2].placeholderKey).toBe("card-inner");
  });

  it("normalises component fields and keeps params", () => {
    const [, cardGrid] = flattenPlaceholders(placeholders);
    expect(cardGrid.fields).toEqual([{ name: "sectionTitle", value: "Brands" }]);
    expect(cardGrid.params).toEqual({ GridParameters: "col-12" });
    expect(cardGrid.datasourcePath).toBe(
      "/sitecore/content/org/site/Data/Cards",
    );
  });

  it("skips the shared placeholders it is told to skip", () => {
    const components = flattenPlaceholders(placeholders, {
      skipPlaceholderKeys: ["headless-header", "headless-footer"],
    });
    expect(components.map((c) => c.type)).toEqual(["CardGrid", "Card"]);
  });

  it("skips dynamic SXA instances of a shared placeholder", () => {
    const components = flattenPlaceholders(
      { "headless-header-{uid}-0": [{ uid: "h", componentName: "Header" }] },
      { skipPlaceholderKeys: ["headless-header"] },
    );
    expect(components).toEqual([]);
  });
});

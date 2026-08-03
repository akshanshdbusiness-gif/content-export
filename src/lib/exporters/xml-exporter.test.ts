import { describe, expect, it } from "vitest";
import type { ExportResult } from "../types";
import {
  escapeXmlAttribute,
  escapeXmlText,
  exportFilename,
  exportToXml,
  htmlToText,
  stripInvalidXmlChars,
  toElementName,
} from "./xml-exporter";

const options = {
  environment: "Dev",
  language: "en",
  keepHtml: false,
  exportedAt: "2026-08-02T10:00:00.000Z",
};

function result(overrides: Partial<ExportResult["pages"][0]> = {}): ExportResult {
  return {
    warnings: [],
    pages: [
      {
        itemPath: "/sitecore/content/org/site/Home/about",
        name: "about",
        language: "en",
        siteName: "site",
        route: "/about",
        fields: [],
        components: [],
        warnings: [],
        ...overrides,
      },
    ],
  };
}

describe("escaping", () => {
  it("escapes the XML metacharacters", () => {
    expect(escapeXmlText('a & b < c > d')).toBe("a &amp; b &lt; c &gt; d");
  });

  it("escapes quotes and flattens newlines in attributes", () => {
    expect(escapeXmlAttribute('say "hi"\nthere')).toBe("say &quot;hi&quot; there");
  });

  it("drops characters XML 1.0 forbids but keeps tab/LF/CR", () => {
    const withNulls = "a" + String.fromCharCode(0, 8, 31) + "bc";
    expect(stripInvalidXmlChars(withNulls)).toBe("abc");
    expect(stripInvalidXmlChars("a\tb\nc\rd")).toBe("a\tb\nc\rd");
  });
});

describe("toElementName", () => {
  it("passes valid names through", () => {
    expect(toElementName("cardList")).toBe("cardList");
  });

  it("replaces characters that are illegal in element names", () => {
    expect(toElementName("Card List")).toBe("Card-List");
  });

  it("prefixes names that start with a digit", () => {
    expect(toElementName("2col")).toBe("_2col");
  });

  it("falls back to <value> when nothing usable is left", () => {
    expect(toElementName("!!!")).toBe("value");
  });
});

describe("htmlToText", () => {
  it("turns block markup into line breaks and decodes entities", () => {
    expect(htmlToText("<p>One</p><p>Two &amp; three</p>")).toBe(
      "One\nTwo & three",
    );
  });

  it("marks list items", () => {
    expect(htmlToText("<ul><li>A</li><li>B</li></ul>")).toBe("- A\n- B");
  });
});

describe("exportToXml", () => {
  it("writes the document header with the export counts", () => {
    const xml = exportToXml(result(), options);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('environment="Dev"');
    expect(xml).toContain('totalPages="1" totalComponents="0"');
    expect(xml).toContain('exportedAt="2026-08-02T10:00:00.000Z"');
  });

  it("renders scalar fields as element text", () => {
    const xml = exportToXml(
      result({ fields: [{ name: "pageTitle", value: "About Acme" }] }),
      options,
    );
    expect(xml).toContain('<Field name="pageTitle">About Acme</Field>');
  });

  it("renders object fields as nested elements, not escaped JSON", () => {
    const xml = exportToXml(
      result({
        fields: [
          {
            name: "ogImage",
            value: { src: "https://cdn/x.jpg", alt: "About", width: 1200 },
          },
        ],
      }),
      options,
    );
    expect(xml).toContain('<Field name="ogImage">');
    expect(xml).toContain("<src>https://cdn/x.jpg</src>");
    expect(xml).toContain("<width>1200</width>");
    expect(xml).not.toContain("&quot;src&quot;");
  });

  it("renders arrays as <item> elements", () => {
    const xml = exportToXml(
      result({
        fields: [
          {
            name: "cardList",
            value: [{ id: "29C9", title: "Aurora" }, { id: "3A11", title: "Lumen" }],
          },
        ],
      }),
      options,
    );
    expect(xml.match(/<item>/g)).toHaveLength(2);
    expect(xml).toContain("<title>Aurora</title>");
  });

  it("groups components under their placeholder", () => {
    const xml = exportToXml(
      result({
        components: [
          {
            index: 0,
            type: "CardGrid",
            uid: "e32417ec",
            placeholderKey: "headless-main",
            params: { GridParameters: "col-12" },
            fields: [{ name: "sectionTitle", value: "Brands" }],
          },
          {
            index: 1,
            type: "RichText",
            placeholderKey: "headless-main",
            fields: [],
          },
        ],
      }),
      options,
    );
    expect(xml).toContain(
      '<Placeholder key="headless-main" componentCount="2">',
    );
    expect(xml).toContain('<Component index="0" type="CardGrid"');
    expect(xml).toContain("<GridParameters>col-12</GridParameters>");
    expect(xml).toContain('totalComponents="2"');
  });

  it("flattens rich text to plain text by default and keeps it with keepHtml", () => {
    const page = result({
      fields: [{ name: "body", value: "<p>Hello <b>world</b></p>" }],
    });
    expect(exportToXml(page, options)).toContain(
      "<Field name=\"body\">Hello world</Field>",
    );
    expect(exportToXml(page, { ...options, keepHtml: true })).toContain(
      "&lt;p&gt;Hello &lt;b&gt;world&lt;/b&gt;&lt;/p&gt;",
    );
  });

  it("emits self-closing elements for empty values", () => {
    const xml = exportToXml(
      result({ fields: [{ name: "subtitle", value: "" }] }),
      options,
    );
    expect(xml).toContain('<Field name="subtitle" />');
  });

  it("includes export-level and page-level warnings", () => {
    const base = result({
      warnings: ["Page has no published route"],
    });
    const xml = exportToXml(
      { ...base, warnings: ["Skipped /a: not found"] },
      options,
    );
    expect(xml).toContain("<Warning>Skipped /a: not found</Warning>");
    expect(xml).toContain("<Warning>Page has no published route</Warning>");
  });
});

describe("exportFilename", () => {
  const date = new Date("2026-08-02T09:00:00Z");

  it("names a single-page export after the page", () => {
    expect(exportFilename(result().pages, date)).toBe(
      "sitecore-export-2026-08-02-about.xml",
    );
  });

  it("omits the suffix for multi-page exports", () => {
    const pages = [...result().pages, ...result().pages];
    expect(exportFilename(pages, date)).toBe("sitecore-export-2026-08-02.xml");
  });

  it("strips characters that are unsafe in a filename", () => {
    const pages = result({ name: "about/us & more" }).pages;
    expect(exportFilename(pages, date)).toBe(
      "sitecore-export-2026-08-02-about-us---more.xml",
    );
  });
});

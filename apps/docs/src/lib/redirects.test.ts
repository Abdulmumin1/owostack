import { describe, expect, it } from "vitest";
import { REDIRECT_SOURCES, resolveRedirect } from "./redirects";
import { source } from "./source";

describe("resolveRedirect", () => {
  it("maps common guesses to canonical pages", () => {
    expect(resolveRedirect("/quickstart")).toBe("/getting-started/quickstart");
    expect(resolveRedirect("/Quickstart/")).toBe("/getting-started/quickstart");
    expect(resolveRedirect("/track")).toBe("/sdk/track");
    expect(resolveRedirect("/customers")).toBe("/sdk/customer");
    expect(resolveRedirect("/environments")).toBe(
      "/getting-started/environments",
    );
    expect(resolveRedirect("/api")).toBe("/api-reference");
  });

  it("strips a /docs prefix, then applies the map", () => {
    expect(resolveRedirect("/docs/sdk/track")).toBe("/sdk/track");
    expect(resolveRedirect("/docs/quickstart")).toBe(
      "/getting-started/quickstart",
    );
    expect(resolveRedirect("/docs")).toBe("/");
  });

  it("leaves canonical paths alone", () => {
    expect(resolveRedirect("/getting-started/quickstart")).toBeNull();
    expect(resolveRedirect("/sdk/track")).toBeNull();
    expect(resolveRedirect("/")).toBeNull();
    expect(resolveRedirect("/api-reference/track")).toBeNull();
  });

  it("carries the .md suffix through for the Markdown route", () => {
    expect(resolveRedirect("/quickstart.md")).toBe(
      "/getting-started/quickstart.md",
    );
    expect(resolveRedirect("/docs.md")).toBe("/index.md");
    expect(resolveRedirect("/openapi.md")).toBe("/openapi.json");
    expect(resolveRedirect("/sdk/track.md")).toBeNull();
  });

  it("every redirect target is a real page (or the spec)", () => {
    for (const from of REDIRECT_SOURCES) {
      const to = resolveRedirect(from);
      expect(to, from).not.toBeNull();
      if (to === "/openapi.json") continue;
      const slugs = to!.split("/").filter(Boolean);
      expect(source.getPage(slugs), `${from} -> ${to}`).toBeDefined();
    }
  });

  it("never redirects a source to itself or to another source", () => {
    for (const from of REDIRECT_SOURCES) {
      const to = resolveRedirect(from)!;
      expect(to).not.toBe(from);
      expect(resolveRedirect(to), `${from} -> ${to} chains`).toBeNull();
    }
  });
});

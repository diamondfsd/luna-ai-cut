import { describe, it, expect, afterEach } from "vitest";
import { shareBaseOrigin } from "./share-origin";
import { generateShareableLink } from "../hooks/use-router";

afterEach(() => {
  delete (window as unknown as { openreel?: unknown }).openreel;
});

describe("shareBaseOrigin", () => {
  it("uses publicOrigin on desktop for share + deep links", () => {
    (window as unknown as { openreel: unknown }).openreel = {
      platform: "desktop",
      publicOrigin: "https://app.openreel.video",
    };
    expect(shareBaseOrigin()).toBe("https://app.openreel.video");
    expect(generateShareableLink("editor")).toMatch(/^https:\/\/app\.openreel\.video#\//);
  });

  it("uses window.location origin+pathname on web", () => {
    const expected = `${window.location.origin}${window.location.pathname}`;
    expect(shareBaseOrigin()).toBe(expected);
  });

  it("redirects disabled Motion Creator links to the video editor", () => {
    const expected = `${window.location.origin}${window.location.pathname}`;
    expect(generateShareableLink("motion", { compositionId: "comp-1" })).toBe(
      `${expected}#/editor`,
    );
  });
});

/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ALL_HOME_SECTION_KEYS } from "../presentation";
import { SectionThumbnail, hasSectionThumbnail } from "../SectionThumbnails";

afterEach(cleanup);

/** CUST-HV V10d — Library thumbnails: a layout wireframe for every section type, decorative only, no fake commerce data. */
describe("section thumbnails", () => {
  it("every section type the builder knows has one (slider and gallery had none)", () => {
    for (const type of ALL_HOME_SECTION_KEYS) expect(hasSectionThumbnail(type), type).toBe(true);
    expect(hasSectionThumbnail("not-a-section")).toBe(false);
  });

  it("each is a decorative SVG with real shapes beyond the frame, and no text at all", () => {
    for (const type of ALL_HOME_SECTION_KEYS) {
      const { container, unmount } = render(<SectionThumbnail type={type} />);
      const svg = container.querySelector("svg") as SVGElement;
      expect(svg.getAttribute("aria-hidden"), type).toBe("true");
      expect(svg.getAttribute("data-section-thumbnail")).toBe(type);
      expect(svg.querySelectorAll("rect,circle,path").length, type).toBeGreaterThan(3);
      expect(svg.textContent, type).toBe("");
      unmount();
    }
  });

  it("thumbnails are structurally distinct per type (they distinguish, not decorate)", () => {
    const markup = ALL_HOME_SECTION_KEYS.map((type) => {
      const { container, unmount } = render(<SectionThumbnail type={type} />);
      const html = container.innerHTML;
      unmount();
      return html;
    });
    expect(new Set(markup).size).toBe(ALL_HOME_SECTION_KEYS.length);
  });

  it("follows the document direction and the app's tokens (no hard-coded colour)", () => {
    const { container } = render(<SectionThumbnail type="hero" />);
    const html = container.innerHTML;
    expect(html).toContain("rtl:-scale-x-100");
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb\(/);
  });
});

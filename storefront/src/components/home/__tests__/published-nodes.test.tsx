/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PresentationHomeSection } from "@/lib/presentation/config";
import { publishedNodes } from "../published-nodes";

afterEach(cleanup);

const ctx = {
  implemented: {
    hero: <section data-testid="hero-root">hero</section>,
    categories: <section data-testid="cat-root">cat</section>,
    newArrivals: <section data-testid="new-root">new</section>,
    wholesale: <section data-testid="wh-root">wh</section>,
  },
  basePath: "/sa/en",
  locale: "en",
  themePreset: undefined,
  apps: { iosUrl: "", androidUrl: "", appName: "" },
  benefitsTitle: "b",
  featuredTitle: "f",
  offersTitle: "o",
  appTitle: "a",
  appStoreLabel: "as",
  playStoreLabel: "ps",
  design: { primaryColor: "#12372a", accentColor: null, dir: "ltr" as const },
};

async function mount(sections: PresentationHomeSection[]) {
  const nodes = await publishedNodes(sections, ctx as never);
  return render(<div>{nodes}</div>).container;
}

describe("published homepage stack (CUST-HV V5c review)", () => {
  it("a designed built-in section's root is the frame's DIRECT child (the design rules address it)", async () => {
    const container = await mount([
      {
        id: "hero",
        type: "hero",
        visible: true,
        design: { background: { kind: "solid", color: { hex: "#fde68a" } } },
      },
      {
        id: "wholesale",
        type: "wholesale",
        visible: true,
        design: { background: { kind: "solid", color: { hex: "#e0f2fe" } } },
      },
    ]);
    const frames = container.querySelectorAll("[data-sd]");
    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(frame.children).toHaveLength(1);
      expect(frame.firstElementChild?.tagName).toBe("SECTION");
    }
  });

  it("an undesigned built-in section keeps its wrapper div exactly as before (byte-identical)", async () => {
    const container = await mount([
      { id: "hero", type: "hero", visible: true },
    ]);
    expect(container.firstElementChild?.innerHTML).toBe(
      '<div><section data-testid="hero-root">hero</section></div>',
    );
  });

  it("a design that resolves to nothing keeps the legacy wrapper (no layout change)", async () => {
    const container = await mount([
      {
        id: "hero",
        type: "hero",
        visible: true,
        design: { typography: { headingScale: "md" } },
      },
    ]);
    expect(container.firstElementChild?.innerHTML).toBe(
      '<div><section data-testid="hero-root">hero</section></div>',
    );
  });
});

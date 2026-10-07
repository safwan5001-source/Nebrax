/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PresentationHomeSection } from "@/lib/presentation/config";
import { hasVisibleHero, publishedNodes } from "../published-nodes";

afterEach(cleanup);

function HeroStub({ designed }: { designed?: boolean }) {
  return (
    <section data-testid="hero-root">
      <div data-section-content={designed ? "" : undefined}>hero</div>
    </section>
  );
}

const ctx = {
  implemented: {
    hero: <HeroStub />,
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
      '<div><section data-testid="hero-root"><div>hero</div></section></div>',
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
      '<div><section data-testid="hero-root"><div>hero</div></section></div>',
    );
  });

  it("design markers appear only while a design frame is active (absent design ⇒ byte-identical)", async () => {
    const content = {
      title: "T",
      subtitle: "",
      ctaLabel: "",
      ctaHref: "",
      imageUrl: "",
    };
    const benefits = { items: [{ id: "i", title: "A", body: "b" }] };
    const sections = (design: PresentationHomeSection["design"]) =>
      [
        { id: "hero", type: "hero", visible: true, design },
        { id: "ban", type: "banner", visible: true, content, design },
        {
          id: "ben",
          type: "benefits",
          visible: true,
          content: benefits,
          design,
        },
      ] as PresentationHomeSection[];

    const plain = await mount(sections(undefined));
    expect(plain.querySelector("[data-section-content]")).toBeNull();
    expect(plain.querySelector("[data-section-block]")).toBeNull();

    const designed = await mount(
      sections({ background: { kind: "solid", color: { hex: "#fde68a" } } }),
    );
    expect(designed.querySelectorAll("[data-section-content]")).toHaveLength(2);
    expect(designed.querySelectorAll("[data-section-block]")).toHaveLength(1);

    // a design that resolves to nothing is the legacy output too
    const inert = await mount(sections({ typography: { headingScale: "md" } }));
    expect(inert.querySelector("[data-section-content]")).toBeNull();
    expect(inert.querySelector("[data-section-block]")).toBeNull();
  });

  it("mounts the reveal observer only when a visible section opted into the reveal", async () => {
    const hasObserver = (nodes: React.ReactNode[]) =>
      nodes.some(
        (node) =>
          typeof node === "object" &&
          node !== null &&
          "key" in node &&
          (node as { key: string }).key === "section-reveal",
      );
    const banner = (reveal: unknown, visible = true) =>
      ({
        id: "ban",
        type: "banner",
        visible,
        content: {
          title: "T",
          subtitle: "",
          ctaLabel: "",
          ctaHref: "",
          imageUrl: "",
        },
        design: { motion: { reveal } },
      }) as PresentationHomeSection;
    expect(
      hasObserver(await publishedNodes([banner("fade-up")], ctx as never)),
    ).toBe(true);
    expect(
      hasObserver(await publishedNodes([banner("none")], ctx as never)),
    ).toBe(false);
    expect(
      hasObserver(
        await publishedNodes([banner("fade-up", false)], ctx as never),
      ),
    ).toBe(false);
    expect(
      hasObserver(
        await publishedNodes(
          [{ id: "hero", type: "hero", visible: true }],
          ctx as never,
        ),
      ),
    ).toBe(false);
  });
});

describe("per-instance heroes (CUST-HV V6a)", () => {
  const renderHero = ({
    section,
    headingLevel,
    designed,
  }: {
    section: PresentationHomeSection;
    headingLevel: 1 | 2;
    designed: boolean;
  }) => {
    const Heading = headingLevel === 1 ? "h1" : "h2";
    return (
      <section
        data-testid={`hero-${section.id}`}
        data-designed={designed ? "" : undefined}
      >
        <Heading>{section.id}</Heading>
      </section>
    );
  };

  async function mountHeroes(sections: PresentationHomeSection[]) {
    const nodes = await publishedNodes(sections, {
      ...ctx,
      renderHero,
    } as never);
    return render(<div>{nodes}</div>).container;
  }

  it("renders each hero from its own instance; the FIRST visible one is the <h1>, the rest <h2>", async () => {
    const container = await mountHeroes([
      { id: "hero-off", type: "hero", visible: false },
      { id: "hero-a", type: "hero", visible: true },
      { id: "cats", type: "categories", visible: true },
      { id: "hero-b", type: "hero", visible: true },
    ]);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe("hero-a");
    expect(container.querySelector("h2")?.textContent).toBe("hero-b");
    expect(container.querySelector('[data-testid="hero-hero-off"]')).toBeNull();
  });

  it("an undesigned hero keeps the legacy wrapper div; a designed one is wrapped by its frame alone", async () => {
    const plain = await mountHeroes([
      { id: "hero", type: "hero", visible: true },
    ]);
    const plainNode = plain.firstElementChild?.firstElementChild;
    expect(plainNode?.tagName).toBe("DIV");
    expect(plainNode?.getAttribute("data-sd")).toBeNull();
    cleanup();
    const framed = await mountHeroes([
      {
        id: "hero",
        type: "hero",
        visible: true,
        design: { background: { kind: "solid", color: { hex: "#101820" } } },
      },
    ]);
    const frame = framed.firstElementChild?.firstElementChild as HTMLElement;
    expect(frame.getAttribute("data-sd")).toContain("bg");
    expect(frame.firstElementChild?.getAttribute("data-testid")).toBe(
      "hero-hero",
    );
    expect(frame.firstElementChild?.hasAttribute("data-designed")).toBe(true);
  });

  it("without renderHero a hero is still the shared type-keyed node (nothing changes for callers that do not opt in)", async () => {
    const container = await mount([
      { id: "hero", type: "hero", visible: true },
    ]);
    expect(container.querySelector('[data-testid="hero-root"]')).toBeTruthy();
  });

  it("hasVisibleHero is true only while a visible hero exists (else the page names the store in a hidden <h1>)", () => {
    expect(hasVisibleHero([{ id: "hero", type: "hero", visible: true }])).toBe(
      true,
    );
    expect(hasVisibleHero([{ id: "hero", type: "hero", visible: false }])).toBe(
      false,
    );
    expect(
      hasVisibleHero([{ id: "cats", type: "categories", visible: true }]),
    ).toBe(false);
    expect(hasVisibleHero([])).toBe(false);
  });
});

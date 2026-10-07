/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { backgroundMediaPath } from "@/lib/presentation/background-media";
import type { PresentationHomeSection } from "@/lib/presentation/config";
import type { ResolvedMedia } from "@/lib/presentation/media-ref";
import { publishedNodes } from "../published-nodes";

type ResolvedContrast = NonNullable<ResolvedMedia["contrast"]>;

afterEach(cleanup);

const ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const MOBILE = "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f";

function resolved(contrast?: ResolvedMedia["contrast"]): ResolvedMedia {
  return {
    width: 1600,
    height: 900,
    decorative: true,
    alt: { ar: null, en: null },
    sources: [
      {
        kind: "w",
        width: 800,
        height: 450,
        format: "webp",
        src: `/api/storefront/media/customizer/${ID}/800w.webp`,
      },
      {
        kind: "w",
        width: 800,
        height: 450,
        format: "jpg",
        src: `/api/storefront/media/customizer/${ID}/800w.jpg`,
      },
    ],
    ...(contrast ? { contrast } : {}),
  };
}

const DARK: ResolvedContrast = { min: [0, 0, 0], max: [40, 50, 60] };
const WIDE: ResolvedContrast = { min: [0, 0, 0], max: [255, 255, 255] };

const renderHero = ({
  section,
  headingLevel,
  designed,
  backdrop,
}: {
  section: PresentationHomeSection;
  headingLevel: 1 | 2;
  designed: boolean;
  backdrop?: React.ReactNode;
}) => {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section
      data-testid={`hero-${section.id}`}
      data-designed={designed ? "" : undefined}
    >
      {backdrop}
      <Heading>{section.id}</Heading>
    </section>
  );
};

const base = {
  implemented: {},
  renderHero,
  basePath: "/sa/en",
  locale: "en",
  apps: { iosUrl: "", androidUrl: "", appName: "" },
  benefitsTitle: "b",
  featuredTitle: "f",
  offersTitle: "o",
  appTitle: "a",
  appStoreLabel: "as",
  playStoreLabel: "ps",
  design: { primaryColor: "#12372a", accentColor: null, dir: "ltr" as const },
};

async function mount(
  sections: PresentationHomeSection[],
  media: Record<string, ResolvedMedia>,
) {
  const nodes = await publishedNodes(sections, { ...base, media } as never);
  return render(<div>{nodes}</div>).container;
}

const heroWith = (id: string, background: unknown): PresentationHomeSection =>
  ({
    id,
    type: "hero",
    visible: true,
    design: { background },
  }) as PresentationHomeSection;

const picture = {
  kind: "media",
  media: { mediaId: ID, decorative: true },
  overlay: { color: { hex: "#000000" }, alpha: 40 },
};

describe("picture backgrounds on the published stack (CUST-HV V6b-3)", () => {
  it("a provable hero gets its backdrop as the first child, the picture tokens, the overlay vars and a proven foreground", async () => {
    const container = await mount([heroWith("hero", picture)], {
      [backgroundMediaPath(0, "media")]: resolved(DARK),
    });
    const frame = container.querySelector("[data-sd]") as HTMLElement;
    const tokens = frame.getAttribute("data-sd")?.split(" ") ?? [];
    expect(tokens).toEqual(expect.arrayContaining(["mbg", "ovl", "fg"]));
    expect(tokens).not.toContain("bg");
    expect(frame.style.getPropertyValue("--sec-ovl")).toBe("#000000");
    expect(frame.style.getPropertyValue("--sec-ovl-a")).toBe("0.4");
    expect(frame.style.getPropertyValue("--sec-fg")).toBe("#ffffff");
    const root = frame.firstElementChild as HTMLElement;
    expect(root.firstElementChild?.getAttribute("data-sd-backdrop")).toBe("");
    expect(root.querySelector("img")?.getAttribute("loading")).toBe("eager");
  });

  it("a picture whose contrast the server did not prove paints nothing and picks no foreground (legacy surface stays)", async () => {
    const container = await mount([heroWith("hero", picture)], {
      [backgroundMediaPath(0, "media")]: resolved(), // no contrast
    });
    const frame = container.firstElementChild?.firstElementChild as HTMLElement;
    expect(frame.getAttribute("data-sd") ?? "").not.toContain("mbg");
    expect(container.querySelector("[data-sd-backdrop]")).toBeNull();
    expect(frame.style.getPropertyValue("--sec-fg")).toBe("");
  });

  it("a full-range picture is unprovable without the overlay's help — no backdrop, no tokens", async () => {
    const container = await mount(
      [
        heroWith("hero", {
          kind: "media",
          media: { mediaId: ID, decorative: true },
        }),
      ],
      { [backgroundMediaPath(0, "media")]: resolved(WIDE) },
    );
    expect(container.querySelector("[data-sd-backdrop]")).toBeNull();
    expect(container.innerHTML).not.toContain("mbg");
  });

  it("the phone picture must be proven too: without its bounds nothing paints", async () => {
    const withMobile = {
      ...picture,
      mobile: { mediaId: MOBILE, decorative: true },
    };
    const only = await mount([heroWith("hero", withMobile)], {
      [backgroundMediaPath(0, "media")]: resolved(DARK),
      [backgroundMediaPath(0, "mobile")]: resolved(),
    });
    expect(only.querySelector("[data-sd-backdrop]")).toBeNull();
    cleanup();
    const both = await mount([heroWith("hero", withMobile)], {
      [backgroundMediaPath(0, "media")]: resolved(DARK),
      [backgroundMediaPath(0, "mobile")]: resolved(DARK),
    });
    expect(
      [...both.querySelectorAll("source")].some((s) => s.getAttribute("media")),
    ).toBe(true);
  });

  it("the path index counts hidden sections: the second hero is the visible one at index 1", async () => {
    const hidden = { ...heroWith("h0", picture), visible: false };
    const container = await mount([hidden, heroWith("h1", picture)], {
      [backgroundMediaPath(1, "media")]: resolved(DARK),
    });
    expect(container.querySelectorAll("[data-sd-backdrop]")).toHaveLength(1);
  });

  it("only the first visible hero is eager; a later one is lazy", async () => {
    const container = await mount(
      [heroWith("a", picture), heroWith("b", picture)],
      {
        [backgroundMediaPath(0, "media")]: resolved(DARK),
        [backgroundMediaPath(1, "media")]: resolved(DARK),
      },
    );
    const loading = [...container.querySelectorAll("img")].map((img) =>
      img.getAttribute("loading"),
    );
    expect(loading).toEqual(["eager", "lazy"]);
  });

  it("a banner renders the same backdrop; a section with no picture background is untouched", async () => {
    const banner = {
      id: "ban",
      type: "banner",
      visible: true,
      content: {
        title: "Sale",
        subtitle: "Today",
        imageUrl: "",
        imageAlt: "",
        ctaLabel: "",
        ctaHref: "",
      },
      design: { background: picture },
    } as unknown as PresentationHomeSection;
    const plain = {
      id: "ban2",
      type: "banner",
      visible: true,
      content: {
        title: "Plain",
        subtitle: "",
        imageUrl: "",
        imageAlt: "",
        ctaLabel: "",
        ctaHref: "",
      },
    } as unknown as PresentationHomeSection;
    const container = await mount([banner, plain], {
      [backgroundMediaPath(0, "media")]: resolved(DARK),
    });
    const sections = container.querySelectorAll("section");
    expect(
      sections[0].firstElementChild?.getAttribute("data-sd-backdrop"),
    ).toBe("");
    expect(sections[1].querySelector("[data-sd-backdrop]")).toBeNull();
  });

  it("without any resolved media (older payloads) nothing changes and nothing throws", async () => {
    const nodes = await publishedNodes([heroWith("hero", picture)], {
      ...base,
    } as never);
    const container = render(<div>{nodes}</div>).container;
    expect(container.querySelector("[data-sd-backdrop]")).toBeNull();
  });
});

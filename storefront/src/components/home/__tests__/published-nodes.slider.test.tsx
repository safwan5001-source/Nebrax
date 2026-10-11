/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PresentationHomeSection } from "@/lib/presentation/config";
import type { ResolvedMedia } from "@/lib/presentation/media-ref";
import { slidePicturePath } from "@/lib/presentation/slider-resolve";
import { publishedNodes } from "../published-nodes";

afterEach(cleanup);

const ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const labels = {
  label: "Featured slides",
  slide: "{current} of {total}",
  previous: "Previous slide",
  next: "Next slide",
  goTo: "Go to slide {number}",
  pause: "Pause slides",
  play: "Play slides",
  choose: "Choose a slide",
};

const resolved = (): ResolvedMedia => ({
  width: 1600,
  height: 900,
  decorative: false,
  alt: { ar: "صورة", en: "A picture" },
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
  contrast: { min: [0, 0, 0], max: [40, 50, 60] },
});

const slider = (
  id: string,
  extra: Partial<PresentationHomeSection> = {},
): PresentationHomeSection => ({
  id,
  type: "slider",
  visible: true,
  content: {
    slides: [
      { id: "a", media: { mediaId: ID }, heading: "First" },
      { id: "b", media: { mediaId: ID }, heading: "Second" },
    ],
  },
  ...extra,
});

const base = {
  implemented: {},
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
  sliderLabels: labels,
};

const mediaFor = (index: number) => ({
  [slidePicturePath(index, 0, "media")]: resolved(),
  [slidePicturePath(index, 1, "media")]: resolved(),
});

async function mount(
  sections: PresentationHomeSection[],
  media: Record<string, ResolvedMedia>,
  extra: Record<string, unknown> = {},
) {
  const nodes = await publishedNodes(sections, {
    ...base,
    media,
    ...extra,
  } as never);
  return render(<div>{nodes}</div>).container;
}

describe("publishedNodes — slider (V8b)", () => {
  it("draws a visible slider from the server's resolved pictures", async () => {
    const c = await mount([slider("sl")], mediaFor(0));
    const root = c.querySelector("[data-slider]");
    expect(root).not.toBeNull();
    expect(root?.getAttribute("dir")).toBe("ltr");
    expect(c.querySelectorAll("[data-slider-slide]")).toHaveLength(2);
    expect(c.querySelector("img")?.getAttribute("alt")).toBe("A picture");
  });

  it("omits a hidden slider, one with no resolvable picture, and one without its labels", async () => {
    expect(
      (
        await mount([slider("sl", { visible: false })], mediaFor(0))
      ).querySelector("[data-slider]"),
    ).toBeNull();
    expect(
      (await mount([slider("sl")], {})).querySelector("[data-slider]"),
    ).toBeNull();
    expect(
      (
        await mount([slider("sl")], mediaFor(0), { sliderLabels: undefined })
      ).querySelector("[data-slider]"),
    ).toBeNull();
  });

  it("keys pictures by the section's index in the WHOLE list (hidden sections included)", async () => {
    const hidden: PresentationHomeSection = {
      id: "x",
      type: "benefits",
      visible: false,
    };
    const c = await mount([hidden, slider("sl")], mediaFor(1));
    expect(c.querySelector("[data-slider]")).not.toBeNull();
    const wrong = await mount([hidden, slider("sl")], mediaFor(0));
    expect(wrong.querySelector("[data-slider]")).toBeNull();
  });

  it("loads the first picture eagerly only when the slider opens the page", async () => {
    const first = await mount([slider("sl")], mediaFor(0));
    expect(first.querySelector("img")?.getAttribute("loading")).toBe("eager");
    cleanup();
    const second = await mount(
      [
        {
          id: "h",
          type: "benefits",
          visible: true,
          content: { items: [{ id: "i", title: "T", body: "B" }] },
        },
        slider("sl"),
      ],
      mediaFor(1),
    );
    expect(
      second.querySelector("[data-slider] img")?.getAttribute("loading"),
    ).toBe("lazy");
  });

  it("a designed slider is wrapped by its frame with the slider as the frame's only child", async () => {
    const c = await mount(
      [
        slider("sl", {
          design: {
            background: { kind: "solid", color: { role: "surface" } },
            spacing: { top: "md" },
            mediaTreatment: { height: "tall" },
          },
        }),
      ],
      mediaFor(0),
    );
    const frame = c.querySelector("[data-sd]") as HTMLElement;
    expect(frame.getAttribute("data-design-type")).toBe("slider");
    expect(frame.getAttribute("data-sd")).toContain("hgt");
    expect(frame.children).toHaveLength(1);
    expect(frame.firstElementChild?.hasAttribute("data-slider")).toBe(true);
  });

  it("an undesigned slider has no frame (nothing else in the page changes)", async () => {
    const c = await mount([slider("sl")], mediaFor(0));
    expect(c.querySelector("[data-sd]")).toBeNull();
  });

  it("the slider direction follows the page direction", async () => {
    const c = await mount([slider("sl")], mediaFor(0), {
      design: { ...base.design, dir: "rtl" },
    });
    expect(c.querySelector("[data-slider]")?.getAttribute("dir")).toBe("rtl");
  });
});

/**
 * @vitest-environment jsdom
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeSlider, type SliderLabels } from "@/components/home/HomeSlider";
import { SectionBackdrop } from "@/components/home/SectionBackdrop";
import type { ResolvedMedia } from "@/lib/presentation/media-ref";
import { resolveSliderBehaviour } from "@/lib/presentation/slider-content";
import type { SliderView, SlideView } from "@/lib/presentation/slider-resolve";

const ID = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const P = "/api/storefront/media/customizer/";
const messages = {
  home: { motion: { pause: "Pause animation", play: "Play animation" } },
};

function stubMatchMedia(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduced && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
}

const media = (tag: string, animated?: "gif" | "webp"): ResolvedMedia => ({
  width: 800,
  height: 400,
  decorative: true,
  alt: { ar: null, en: "pic" },
  sources: [
    {
      kind: "w",
      width: 800,
      height: 400,
      format: "webp",
      src: `${P}${ID}/${tag}800w.webp`,
    },
    {
      kind: "w",
      width: 800,
      height: 400,
      format: "jpg",
      src: `${P}${ID}/${tag}800w.jpg`,
    },
  ],
  ...(animated
    ? {
        animation: {
          src: `${P}${ID}/animated.${animated}`,
          format: animated,
          frames: 4,
          durationMs: 800,
          loop: true,
        },
      }
    : {}),
});

const withIntl = (ui: React.ReactElement) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {ui}
  </NextIntlClientProvider>
);

const sourcesOf = (root: ParentNode) =>
  Array.from(root.querySelectorAll("picture > source")).map((s) => [
    s.getAttribute("media"),
    s.getAttribute("type"),
    s.getAttribute("srcset"),
  ]);

beforeEach(() => stubMatchMedia(false));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SectionBackdrop with an animated picture", () => {
  it("lists the reduced-motion still FIRST, then the animation, then the stills (order is the contract)", () => {
    const { container } = render(
      withIntl(
        <SectionBackdrop data={{ media: media("d", "gif"), overlay: false }} />,
      ),
    );
    const list = sourcesOf(container);
    expect(list[0]).toEqual([
      "(prefers-reduced-motion: reduce)",
      "image/webp",
      `${P}${ID}/d800w.webp 800w`,
    ]);
    expect(list[1]?.[1]).toBe("image/jpeg");
    expect(list[2]).toEqual([null, "image/gif", `${P}${ID}/animated.gif`]);
    expect(list[3]).toEqual([null, "image/webp", `${P}${ID}/d800w.webp 800w`]);
    // the <img> fallback is the still first frame, never the animation
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(`${P}${ID}/d800w.jpg`);
    expect(img.getAttribute("alt")).toBe("");
  });

  it("offers a labelled pause control outside the aria-hidden layer; pausing drops the animated source, playing restores it", async () => {
    const { container } = render(
      withIntl(
        <SectionBackdrop
          data={{ media: media("d", "webp"), overlay: false }}
        />,
      ),
    );
    const layer = container.querySelector("[data-sd-backdrop]") as HTMLElement;
    expect(layer.getAttribute("aria-hidden")).toBe("true");

    const toggle = await screen.findByRole("button", {
      name: "Pause animation",
    });
    expect(layer.contains(toggle)).toBe(false);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(
      sourcesOf(container).some(
        ([, , set]) => set === `${P}${ID}/animated.webp`,
      ),
    ).toBe(true);

    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(
      sourcesOf(container).some(([, , set]) =>
        String(set).includes("animated."),
      ),
    ).toBe(false);
    const playing = screen.getByRole("button", { name: "Play animation" });
    expect(playing.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      fireEvent.click(playing);
    });
    expect(
      sourcesOf(container).some(
        ([, , set]) => set === `${P}${ID}/animated.webp`,
      ),
    ).toBe(true);
  });

  it("renders no control for a visitor who prefers reduced motion (they get the still frame)", async () => {
    stubMatchMedia(true);
    render(
      withIntl(
        <SectionBackdrop data={{ media: media("d", "gif"), overlay: false }} />,
      ),
    );
    await act(async () => undefined);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("server markup (what a no-JavaScript visitor gets) is the still ladder only: no animation, no dead control", () => {
    const html = renderToString(
      withIntl(
        <SectionBackdrop data={{ media: media("d", "gif"), overlay: false }} />,
      ),
    );
    expect(html).not.toContain("<button");
    expect(html).not.toContain("animated.gif");
    expect(html).toContain("d800w.jpg"); // the still <img>
    expect(html).toContain("prefers-reduced-motion"); // stills stay first for reduced motion
  });

  it("after hydration the animation is added back (and the control appears)", async () => {
    const { container } = render(
      withIntl(
        <SectionBackdrop data={{ media: media("d", "gif"), overlay: false }} />,
      ),
    );
    await screen.findByRole("button", { name: "Pause animation" });
    expect(
      sourcesOf(container).some(
        ([, , set]) => set === `${P}${ID}/animated.gif`,
      ),
    ).toBe(true);
  });

  it("a static backdrop is byte-for-byte what it was: one picture, no control, no animated sources", async () => {
    const { container } = render(
      withIntl(
        <SectionBackdrop data={{ media: media("d"), overlay: false }} />,
      ),
    );
    await act(async () => undefined);
    expect(screen.queryByRole("button")).toBeNull();
    expect(sourcesOf(container)).toEqual([
      [null, "image/webp", `${P}${ID}/d800w.webp 800w`],
    ]);
  });

  it("phone animation is art-directed: gated to the phone query, ahead of the phone stills", () => {
    const { container } = render(
      withIntl(
        <SectionBackdrop
          data={{
            media: media("d"),
            mobile: media("m", "gif"),
            overlay: false,
          }}
        />,
      ),
    );
    const list = sourcesOf(container);
    const animated = list.findIndex(([, type]) => type === "image/gif");
    const phoneStill = list.findIndex(
      ([m, type]) => m === "(max-width: 767px)" && type === "image/webp",
    );
    expect(list[animated]).toEqual([
      "(max-width: 767px)",
      "image/gif",
      `${P}${ID}/animated.gif`,
    ]);
    expect(animated).toBeLessThan(phoneStill);
    expect(
      list
        .slice(0, animated)
        .every(([m]) => String(m).includes("prefers-reduced-motion")),
    ).toBe(true);
  });
});

describe("HomeSlider with animated slides", () => {
  const labels: SliderLabels = {
    label: "Featured",
    slide: "{current} of {total}",
    previous: "Prev",
    next: "Next",
    goTo: "Go {number}",
    pause: "Pause slides",
    play: "Play slides",
    choose: "Choose",
  };
  const slide = (i: number, animated?: "gif"): SlideView => ({
    id: `s${i}`,
    position: i + 1,
    media: media(`m${i}`, animated),
    mobile: null,
    alt: `Alt ${i + 1}`,
    heading: `H${i + 1}`,
    sub: "",
    cta: null,
    foreground: "#ffffff",
    buttonLabel: "#000000",
    overlay: null,
    align: "start",
    surface: "picture",
  });
  const view = (animated: boolean): SliderView => ({
    slides: [slide(0, animated ? "gif" : undefined), slide(1), slide(2)],
    behaviour: resolveSliderBehaviour(undefined),
  });
  const mount = (v: SliderView) =>
    render(
      withIntl(
        <HomeSlider
          view={v}
          labels={labels}
          basePath="/sa/ar"
          dir="ltr"
          sectionId="sl"
        />,
      ),
    );

  it("adds the motion toggle to the existing control bar and plays the animated slide", async () => {
    mount(view(true));
    const toggle = await screen.findByRole("button", {
      name: "Pause animation",
    });
    expect(toggle.closest("[data-slider-bar]")).not.toBeNull();
    expect(
      document.querySelectorAll(
        "[data-slider-slide] picture source[type='image/gif']",
      ).length,
    ).toBe(1);
  });

  it("without animated slides there is no motion toggle and no animated source", async () => {
    mount(view(false));
    await act(async () => undefined);
    expect(document.querySelector("[data-motion-toggle]")).toBeNull();
    expect(document.querySelector("source[type='image/gif']")).toBeNull();
  });
});

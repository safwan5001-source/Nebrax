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
import type { GalleryLabels } from "@/components/home/GalleryClient";
import { HomeGallery } from "@/components/home/HomeGallery";
import { MOTION_BUDGET_MS } from "@/lib/presentation/animated-sources";
import { resolveGalleryOptions } from "@/lib/presentation/gallery-content";
import type {
  GalleryImageView,
  GalleryView,
} from "@/lib/presentation/gallery-resolve";
import type {
  ResolvedAnimation,
  ResolvedMedia,
} from "@/lib/presentation/media-ref";

/**
 * AWJ-ANIMATED-MEDIA — animated GIF / WebP pictures in the published gallery: source precedence, SSR / no-JS stills, the
 * reduced-motion poster, the viewer, and the WCAG 2.2.2 policy (one visible control when `showMotionControls` is on; a bounded
 * play window when it is off). Each test uses its own `sectionId` because the pause state is module-level by design.
 */

const P = "/api/storefront/media/customizer/";
const messages = {
  home: { motion: { pause: "Pause animation", play: "Play animation" } },
};
const labels: GalleryLabels = {
  label: "Gallery",
  item: "Picture {number}",
  previous: "Previous pictures",
  next: "Next pictures",
  open: "View picture {number} larger",
  viewer: "Picture viewer",
  close: "Close viewer",
  viewerPrevious: "Previous picture",
  viewerNext: "Next picture",
  counter: "{current} of {total}",
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

const animation = (
  id: string,
  format: "gif" | "webp",
  extra: Partial<ResolvedAnimation> = {},
): ResolvedAnimation => ({
  src: `${P}${id}/animated.${format}`,
  format,
  frames: 8,
  durationMs: 1200,
  loop: true,
  ...extra,
});

function picture(id: string, anim?: ResolvedAnimation): ResolvedMedia {
  return {
    width: 1600,
    height: 900,
    decorative: false,
    alt: { ar: null, en: "Pic" },
    sources: [
      {
        kind: "w",
        width: 800,
        height: 450,
        format: "webp",
        src: `${P}${id}/800w.webp`,
      },
      {
        kind: "w",
        width: 800,
        height: 450,
        format: "jpg",
        src: `${P}${id}/800w.jpg`,
      },
      {
        kind: "w",
        width: 1600,
        height: 900,
        format: "jpg",
        src: `${P}${id}/1600w.jpg`,
      },
    ],
    ...(anim ? { animation: anim } : {}),
  };
}

function image(i: number, anim?: ResolvedAnimation): GalleryImageView {
  return {
    id: `i${i}`,
    position: i + 1,
    media: picture(`m${i}`, anim),
    fit: "cover",
    alt: `Alt ${i + 1}`,
    caption: "",
    link: null,
  };
}

const view = (
  images: GalleryImageView[],
  options: Parameters<typeof resolveGalleryOptions>[0] = undefined,
): GalleryView => ({
  images,
  options: resolveGalleryOptions(options),
  layout: "grid",
});

function gallery(v: GalleryView, sectionId: string) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <HomeGallery
        view={v}
        labels={labels}
        basePath="/sa/en"
        dir="ltr"
        priority={false}
        sectionId={sectionId}
      />
    </NextIntlClientProvider>
  );
}

const sourcesOf = (root: ParentNode) =>
  Array.from(root.querySelectorAll("picture > source")).map((s) => [
    s.getAttribute("media"),
    s.getAttribute("type"),
    s.getAttribute("srcset"),
  ]);
const animatedSources = (root: ParentNode) =>
  sourcesOf(root).filter(([, , set]) => String(set).includes("/animated."));

beforeEach(() => stubMatchMedia(false));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.style.overflow = "";
});

describe("gallery with animated pictures — markup and source precedence", () => {
  it("an animated GIF lists the reduced-motion stills FIRST, then the GIF, then the still ladder; the <img> is the first frame", () => {
    const { container } = render(
      gallery(view([image(0, animation("m0", "gif")), image(1)]), "g-order"),
    );
    const first = container.querySelectorAll("picture")[0];
    const list = sourcesOf(first);
    expect(list[0]).toEqual([
      "(prefers-reduced-motion: reduce)",
      "image/webp",
      `${P}m0/800w.webp 800w`,
    ]);
    expect(list[1]?.slice(0, 2)).toEqual([
      "(prefers-reduced-motion: reduce)",
      "image/jpeg",
    ]);
    expect(list[2]).toEqual([null, "image/gif", `${P}m0/animated.gif`]);
    expect(list[3]).toEqual([null, "image/webp", `${P}m0/800w.webp 800w`]);
    const img = first.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(`${P}m0/1600w.jpg`);
    expect(img.getAttribute("alt")).toBe("Alt 1");
    expect(first.getAttribute("data-gallery-picture")).toBe("");
  });

  it("an animated WebP is offered with its own type; a still neighbour keeps the plain picture", () => {
    const { container } = render(
      gallery(view([image(0, animation("m0", "webp")), image(1)]), "g-webp"),
    );
    const [animated, plain] = Array.from(container.querySelectorAll("picture"));
    expect(animatedSources(animated)).toEqual([
      [null, "image/webp", `${P}m0/animated.webp`],
    ]);
    expect(animatedSources(plain)).toEqual([]);
    expect(sourcesOf(plain)).toEqual([
      [null, "image/webp", `${P}m1/800w.webp 800w`],
    ]);
  });

  it("the server renders only stills (no-JS / first paint never gets motion it cannot stop) and no control", () => {
    const html = renderToString(
      gallery(
        view([image(0, animation("m0", "gif")), image(1)], {
          showMotionControls: true,
        }),
        "g-ssr",
      ),
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(animatedSources(doc)).toEqual([]);
    expect(doc.querySelector("[data-motion-toggle]")).toBeNull();
    // the reduced-motion posters and the still ladder are present
    expect(
      sourcesOf(doc).some(([m]) => m === "(prefers-reduced-motion: reduce)"),
    ).toBe(true);
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(
      `${P}m0/1600w.jpg`,
    );
  });

  it("a gallery with no animated picture renders byte-identically whatever showMotionControls says", () => {
    const stills = () => [image(0), image(1), image(2)];
    const base = renderToString(gallery(view(stills()), "g-same"));
    const opted = renderToString(
      gallery(view(stills(), { showMotionControls: true }), "g-same"),
    );
    expect(opted).toBe(base);
    expect(base).not.toContain("data-gallery-motion");
  });
});

describe("motion controls preference (showMotionControls)", () => {
  it("off (default): no pause button is drawn at all", async () => {
    const { container } = render(
      gallery(view([image(0, animation("m0", "gif")), image(1)]), "g-off"),
    );
    await act(async () => undefined);
    expect(screen.queryByRole("button", { name: /animation/i })).toBeNull();
    expect(container.querySelector("[data-gallery-motion]")).toBeNull();
    expect(animatedSources(container)).toHaveLength(1);
  });

  it("on: ONE control for the whole gallery pauses and resumes every animated picture; nothing auto-stops", async () => {
    vi.useFakeTimers();
    const { container } = render(
      gallery(
        view(
          [
            image(0, animation("m0", "gif")),
            image(1, animation("m1", "webp")),
            image(2),
          ],
          {
            showMotionControls: true,
          },
        ),
        "g-on",
      ),
    );
    await act(async () => undefined);
    const toggles = screen.getAllByRole("button", { name: "Pause animation" });
    expect(toggles).toHaveLength(1);
    expect(
      container.querySelector("[data-gallery-motion]")?.contains(toggles[0]),
    ).toBe(true);
    expect(animatedSources(container)).toHaveLength(2);

    // the control IS the mechanism: a long wait never freezes anything
    await act(async () => {
      vi.advanceTimersByTime(MOTION_BUDGET_MS * 4);
    });
    expect(animatedSources(container)).toHaveLength(2);

    await act(async () => {
      fireEvent.click(toggles[0]);
    });
    expect(animatedSources(container)).toHaveLength(0);
    expect(toggles[0].getAttribute("aria-pressed")).toBe("true");
    expect(toggles[0].getAttribute("aria-label")).toBe("Play animation");
    // the still is what remains
    expect(
      container
        .querySelectorAll("picture")[0]
        .querySelector("img")
        ?.getAttribute("src"),
    ).toBe(`${P}m0/1600w.jpg`);

    await act(async () => {
      fireEvent.click(toggles[0]);
    });
    expect(animatedSources(container)).toHaveLength(2);
  });

  it("on, but the visitor prefers reduced motion: no control and the posters win", async () => {
    stubMatchMedia(true);
    const { container } = render(
      gallery(
        view([image(0, animation("m0", "gif")), image(1)], {
          showMotionControls: true,
        }),
        "g-reduced",
      ),
    );
    await act(async () => undefined);
    expect(screen.queryByRole("button", { name: /animation/i })).toBeNull();
    // the browser resolves the first matching <source>: the reduced-motion poster precedes the animation
    const list = sourcesOf(container.querySelector("picture") as ParentNode);
    const poster = list.findIndex(
      ([m]) => m === "(prefers-reduced-motion: reduce)",
    );
    const motion = list.findIndex(([, t]) => t === "image/gif");
    expect(poster).toBeGreaterThanOrEqual(0);
    expect(poster).toBeLessThan(motion);
  });

  it("off: a looping animation plays a bounded window once on screen, then settles on its still (WCAG 2.2.2)", async () => {
    vi.useFakeTimers();
    const { container } = render(
      gallery(
        view([
          image(0, animation("m0", "gif")),
          image(1, animation("m1", "gif")),
        ]),
        "g-budget",
      ),
    );
    await act(async () => undefined);
    expect(animatedSources(container)).toHaveLength(2);
    await act(async () => {
      vi.advanceTimersByTime(MOTION_BUDGET_MS - 1);
    });
    expect(animatedSources(container)).toHaveLength(2);
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(animatedSources(container)).toHaveLength(0);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      `${P}m0/1600w.jpg`,
    );
    expect(MOTION_BUDGET_MS).toBe(5000);
  });

  it("off: a short play-once animation is left alone (it ends by itself inside the budget)", async () => {
    vi.useFakeTimers();
    const { container } = render(
      gallery(
        view([
          image(0, animation("m0", "gif", { loop: false, durationMs: 2000 })),
          image(1),
        ]),
        "g-once",
      ),
    );
    await act(async () => undefined);
    await act(async () => {
      vi.advanceTimersByTime(MOTION_BUDGET_MS * 3);
    });
    expect(animatedSources(container)).toHaveLength(1);
  });

  it("off: a play-once animation LONGER than the budget is still capped", async () => {
    vi.useFakeTimers();
    const { container } = render(
      gallery(
        view([
          image(0, animation("m0", "gif", { loop: false, durationMs: 9000 })),
          image(1),
        ]),
        "g-long",
      ),
    );
    await act(async () => undefined);
    await act(async () => {
      vi.advanceTimersByTime(MOTION_BUDGET_MS + 10);
    });
    expect(animatedSources(container)).toHaveLength(0);
  });

  it("off: the clock starts only when the picture is on screen", async () => {
    vi.useFakeTimers();
    const observers: Array<
      (entries: Array<{ isIntersecting: boolean }>) => void
    > = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
          observers.push(cb);
        }
        observe() {}
        disconnect() {}
      },
    );
    const { container } = render(
      gallery(view([image(0, animation("m0", "gif")), image(1)]), "g-visible"),
    );
    await act(async () => undefined);
    await act(async () => {
      vi.advanceTimersByTime(MOTION_BUDGET_MS * 2);
    });
    expect(animatedSources(container)).toHaveLength(1); // never seen ⇒ never counted
    await act(async () => {
      for (const cb of observers) cb([{ isIntersecting: true }]);
    });
    await act(async () => {
      vi.advanceTimersByTime(MOTION_BUDGET_MS + 1);
    });
    expect(animatedSources(container)).toHaveLength(0);
  });
});

describe("gallery viewer (lightbox) with animated pictures", () => {
  const open = async (container: HTMLElement, index: number) => {
    await act(async () => {
      fireEvent.click(
        container.querySelector(
          `a[data-gallery-open="${index}"]`,
        ) as HTMLElement,
      );
    });
    return screen.findByRole("dialog");
  };

  it("the viewer plays the animation with the same precedence (poster, animation, stills) and no flattening", async () => {
    const { container } = render(
      gallery(
        view([image(0, animation("m0", "gif")), image(1)], { lightbox: true }),
        "g-lb",
      ),
    );
    const dialog = await open(container, 0);
    const picture = dialog.querySelector("picture") as HTMLElement;
    const list = sourcesOf(picture);
    expect(list[0]?.[0]).toBe("(prefers-reduced-motion: reduce)");
    expect(list.find(([, t]) => t === "image/gif")).toEqual([
      null,
      "image/gif",
      `${P}m0/animated.gif`,
    ]);
    // the viewer's poster is built for full width (not the grid's column sizes)
    expect(picture.querySelector("source")?.getAttribute("sizes")).toBe(
      "100vw",
    );
    expect(picture.querySelector("img")?.getAttribute("src")).toBe(
      `${P}m0/1600w.jpg`,
    );
    // off ⇒ no pause control in the viewer either
    expect(dialog.querySelector("[data-motion-toggle]")).toBeNull();
  });

  it("stepping to a still picture swaps in a plain picture; stepping back restores the animation", async () => {
    const { container } = render(
      gallery(
        view([image(0, animation("m0", "gif")), image(1)], { lightbox: true }),
        "g-lb-nav",
      ),
    );
    const dialog = await open(container, 0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next picture" }));
    });
    expect(animatedSources(dialog)).toEqual([]);
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(
      `${P}m1/1600w.jpg`,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Previous picture" }));
    });
    expect(animatedSources(dialog)).toHaveLength(1);
  });

  it("with showMotionControls the viewer shows the same control and shares the gallery's state", async () => {
    const { container } = render(
      gallery(
        view([image(0, animation("m0", "webp")), image(1)], {
          lightbox: true,
          showMotionControls: true,
        }),
        "g-lb-on",
      ),
    );
    // pause in the grid …
    await act(async () => undefined);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause animation" }));
    });
    const dialog = await open(container, 0);
    // … and the viewer opens already still, with a "Play" control of its own
    expect(animatedSources(dialog)).toEqual([]);
    const play = dialog.querySelector("[data-motion-toggle]") as HTMLElement;
    expect(play.getAttribute("aria-label")).toBe("Play animation");
    await act(async () => {
      fireEvent.click(play);
    });
    expect(animatedSources(dialog)).toEqual([
      [null, "image/webp", `${P}m0/animated.webp`],
    ]);
  });

  it("without the control the viewer applies the same bounded window to a looping animation", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = render(
      gallery(
        view([image(0, animation("m0", "gif")), image(1)], { lightbox: true }),
        "g-lb-budget",
      ),
    );
    const dialog = await open(container, 0);
    expect(animatedSources(dialog)).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(MOTION_BUDGET_MS + 1);
    });
    expect(animatedSources(dialog)).toHaveLength(0);
  });
});

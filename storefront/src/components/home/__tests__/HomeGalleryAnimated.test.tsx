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

/**
 * A controllable `IntersectionObserver`: nothing is "on screen" until a test calls `show(element)` for the observed element.
 * `live()` is how many observers are still connected (a leaked observer would keep a hidden picture alive).
 */
function installObserver() {
  const entries: Array<{
    cb: (e: Array<{ isIntersecting: boolean }>) => void;
    target: Element | null;
    connected: boolean;
  }> = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private entry: (typeof entries)[number];
      constructor(cb: (e: Array<{ isIntersecting: boolean }>) => void) {
        this.entry = { cb, target: null, connected: true };
        entries.push(this.entry);
      }
      observe(target: Element) {
        this.entry.target = target;
      }
      disconnect() {
        this.entry.connected = false;
      }
    },
  );
  return {
    live: () => entries.filter((e) => e.connected).length,
    created: () => entries.length,
    async show(target: Element | null) {
      await act(async () => {
        for (const e of entries) {
          if (e.connected && e.target === target)
            e.cb([{ isIntersecting: true }]);
        }
      });
    },
  };
}

const pictureOf = (container: ParentNode, n: number) =>
  container
    .querySelectorAll("[data-gallery-item]")
    [n].querySelector("picture") as HTMLElement;
const imgOf = (container: ParentNode, n: number) =>
  pictureOf(container, n).querySelector("img") as HTMLImageElement;

describe("off: animation is added and timed only when the picture is on screen", () => {
  const twoAnimated = () =>
    view([image(0, animation("m0", "gif")), image(1, animation("m1", "webp"))]);

  it("an off-screen picture neither adds its animated source nor runs a clock", async () => {
    vi.useFakeTimers();
    const io = installObserver();
    const { container } = render(gallery(twoAnimated(), "g-off-screen"));
    await act(async () => undefined);
    expect(io.live()).toBe(2);
    expect(animatedSources(container)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      vi.advanceTimersByTime(MOTION_BUDGET_MS * 4);
    });
    expect(animatedSources(container)).toEqual([]); // never seen ⇒ never fetched, never counted
    // the posters and the still ladder are untouched
    expect(
      sourcesOf(pictureOf(container, 0)).some(
        ([m]) => m === "(prefers-reduced-motion: reduce)",
      ),
    ).toBe(true);
    expect(imgOf(container, 0).getAttribute("src")).toBe(`${P}m0/1600w.jpg`);
  });

  it("entering view adds the animation and starts the window in the same step; each picture has its own clock", async () => {
    vi.useFakeTimers();
    const io = installObserver();
    const { container } = render(gallery(twoAnimated(), "g-enter"));
    await act(async () => undefined);

    await io.show(imgOf(container, 0));
    expect(animatedSources(pictureOf(container, 0))).toEqual([
      [null, "image/gif", `${P}m0/animated.gif`],
    ]);
    expect(animatedSources(pictureOf(container, 1))).toEqual([]); // the other tile is still off screen
    expect(vi.getTimerCount()).toBe(1); // the clock exists exactly when the source does

    await act(async () => {
      vi.advanceTimersByTime(MOTION_BUDGET_MS - 1);
    });
    expect(animatedSources(pictureOf(container, 0))).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(animatedSources(pictureOf(container, 0))).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);

    // the second tile scrolls in much later and still gets its own full window
    await io.show(imgOf(container, 1));
    expect(animatedSources(pictureOf(container, 1))).toEqual([
      [null, "image/webp", `${P}m1/animated.webp`],
    ]);
    await act(async () => {
      vi.advanceTimersByTime(MOTION_BUDGET_MS - 1);
    });
    expect(animatedSources(pictureOf(container, 1))).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(animatedSources(pictureOf(container, 1))).toEqual([]);
  });

  it("with the control shown nothing is gated: the animation is added at hydration, no observer, no clock", async () => {
    vi.useFakeTimers();
    const io = installObserver();
    const { container } = render(
      gallery(
        view(
          [image(0, animation("m0", "gif")), image(1, animation("m1", "webp"))],
          { showMotionControls: true },
        ),
        "g-on-ungated",
      ),
    );
    await act(async () => undefined);
    expect(io.created()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(animatedSources(container)).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "Pause animation" }),
    ).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(MOTION_BUDGET_MS * 5);
    });
    expect(animatedSources(container)).toHaveLength(2);
  });

  it("a short play-once file is not gated either (it ends by itself), so it is added at hydration", async () => {
    const io = installObserver();
    const { container } = render(
      gallery(
        view([
          image(0, animation("m0", "gif", { loop: false, durationMs: 2000 })),
          image(1),
        ]),
        "g-once-ungated",
      ),
    );
    await act(async () => undefined);
    expect(io.created()).toBe(0);
    expect(animatedSources(container)).toHaveLength(1);
  });

  it("reduced motion: the poster still precedes the animation once it is added, and no control appears", async () => {
    stubMatchMedia(true);
    const io = installObserver();
    const { container } = render(gallery(twoAnimated(), "g-reduced-gated"));
    await act(async () => undefined);
    await io.show(imgOf(container, 0));
    const list = sourcesOf(pictureOf(container, 0));
    const poster = list.findIndex(
      ([m]) => m === "(prefers-reduced-motion: reduce)",
    );
    const motion = list.findIndex(([, t]) => t === "image/gif");
    expect(poster).toBeGreaterThanOrEqual(0);
    expect(poster).toBeLessThan(motion); // the browser picks the poster, so the file is never requested
    expect(screen.queryByRole("button", { name: /animation/i })).toBeNull();
  });

  it("re-mounting: an unmount before entering leaves no observer or clock; a fresh mount is gated again", async () => {
    vi.useFakeTimers();
    const io = installObserver();
    const first = render(gallery(twoAnimated(), "g-remount"));
    await act(async () => undefined);
    expect(io.live()).toBe(2);
    first.unmount();
    expect(io.live()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    const second = render(gallery(twoAnimated(), "g-remount"));
    await act(async () => undefined);
    expect(animatedSources(second.container)).toEqual([]);
    await io.show(imgOf(second.container, 0));
    expect(animatedSources(pictureOf(second.container, 0))).toHaveLength(1);

    // unmounting mid-window cancels the clock (no timer fires into a dead component)
    expect(vi.getTimerCount()).toBe(1);
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a window already spent stays spent after a re-mount: the picture is never re-animated", async () => {
    vi.useFakeTimers();
    const io = installObserver();
    const first = render(gallery(twoAnimated(), "g-spent"));
    await act(async () => undefined);
    await io.show(imgOf(first.container, 0));
    await act(async () => {
      vi.advanceTimersByTime(MOTION_BUDGET_MS + 1);
    });
    expect(animatedSources(pictureOf(first.container, 0))).toEqual([]);
    first.unmount();

    const second = render(gallery(twoAnimated(), "g-spent"));
    await act(async () => undefined);
    await io.show(imgOf(second.container, 0));
    expect(animatedSources(second.container)).toEqual([]); // spent tile: still. never-seen sibling: gated, none yet
    expect(vi.getTimerCount()).toBe(0);
    // the sibling that was never shown still gets its own window
    await io.show(imgOf(second.container, 1));
    expect(animatedSources(pictureOf(second.container, 1))).toHaveLength(1);
  });

  it("without IntersectionObserver the animation is added right after hydration and the window starts then", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", undefined);
    const { container } = render(gallery(twoAnimated(), "g-no-io"));
    await act(async () => undefined);
    expect(animatedSources(container)).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(2);
    await act(async () => {
      vi.advanceTimersByTime(MOTION_BUDGET_MS + 1);
    });
    expect(animatedSources(container)).toEqual([]);
  });
});

describe("off: gallery ⇄ viewer navigation with gated animation", () => {
  const openViewer = async (container: HTMLElement, index: number) => {
    await act(async () => {
      fireEvent.click(
        container.querySelector(
          `a[data-gallery-open="${index}"]`,
        ) as HTMLElement,
      );
    });
    return screen.findByRole("dialog");
  };
  const viewerImg = (dialog: HTMLElement) =>
    dialog.querySelector("img") as HTMLImageElement;
  const lb = () =>
    view(
      [
        image(0, animation("m0", "gif")),
        image(1),
        image(2, animation("m2", "webp")),
      ],
      { lightbox: true },
    );

  it("the viewer's picture is gated too: no animation until it is on screen, then source and clock start together", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const io = installObserver();
    const { container } = render(gallery(lb(), "g-lb-gated"));
    const dialog = await openViewer(container, 0);
    expect(animatedSources(dialog)).toEqual([]);
    await io.show(viewerImg(dialog));
    expect(animatedSources(dialog)).toEqual([
      [null, "image/gif", `${P}m0/animated.gif`],
    ]);
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(animatedSources(dialog)).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(animatedSources(dialog)).toEqual([]);
  });

  it("stepping away and back re-mounts the picture: gated again, and a spent window stays spent", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const io = installObserver();
    const { container } = render(gallery(lb(), "g-lb-nav-gated"));
    const dialog = await openViewer(container, 0);
    await io.show(viewerImg(dialog));
    expect(animatedSources(dialog)).toHaveLength(1);

    // step to the still picture: a plain <picture>, no animation, no observer left behind for the old one
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next picture" }));
    });
    expect(viewerImg(dialog).getAttribute("src")).toBe(`${P}m1/1600w.jpg`);
    expect(animatedSources(dialog)).toEqual([]);

    // and on to the animated WebP: gated until shown, then its own window
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next picture" }));
    });
    expect(animatedSources(dialog)).toEqual([]);
    await io.show(viewerImg(dialog));
    expect(animatedSources(dialog)).toEqual([
      [null, "image/webp", `${P}m2/animated.webp`],
    ]);

    // back to picture 0 (loop around): its window was only partly used → gated again, then animates again (a new, user-started visit)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Previous picture" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Previous picture" }));
    });
    expect(viewerImg(dialog).getAttribute("src")).toBe(`${P}m0/1600w.jpg`);
    expect(animatedSources(dialog)).toEqual([]);
    await io.show(viewerImg(dialog));
    expect(animatedSources(dialog)).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(5200);
    });
    expect(animatedSources(dialog)).toEqual([]);

    // once spent, leaving and returning never restarts it
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next picture" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Previous picture" }));
    });
    await io.show(viewerImg(dialog));
    expect(animatedSources(dialog)).toEqual([]);
  });

  it("closing the viewer leaves no observer or running clock behind", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const io = installObserver();
    const { container } = render(gallery(lb(), "g-lb-close"));
    const before = io.live();
    const dialog = await openViewer(container, 0);
    expect(io.live()).toBeGreaterThan(before);
    await io.show(viewerImg(dialog));
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(io.live()).toBe(before);
  });

  it("with the control shown the viewer is not gated: animation at once, same shared state as the grid", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const io = installObserver();
    const { container } = render(
      gallery(
        view([image(0, animation("m0", "gif")), image(1)], {
          lightbox: true,
          showMotionControls: true,
        }),
        "g-lb-on-gated",
      ),
    );
    await act(async () => undefined);
    const dialog = await openViewer(container, 0);
    expect(io.created()).toBe(0);
    expect(animatedSources(dialog)).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(MOTION_BUDGET_MS * 3);
    });
    expect(animatedSources(dialog)).toHaveLength(1);
  });
});

/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasSlider, type CanvasSliderLabels } from "../CanvasSlider";
import { setAnimatedPreview } from "../media/animated-preview-store";
import { CanvasBackdrop } from "../media/CanvasBackdrop";
import { CANVAS_MOTION_TOGGLE_STYLE } from "../media/CanvasMotion";
import type { SectionBackground } from "../presentation/section-design";
import type { DesignContext } from "../presentation/section-design-resolve";

/**
 * AWJ-ANIMATED-MEDIA — Canvas ↔ storefront parity for animated GIF / WebP: the Canvas plays the signed sanitised animation on the
 * same `<picture><img>` the storefront draws, with the storefront's pause/play control, still-by-default for reduced motion.
 */

// the signed workspace preview is the editor's only still source; the animated URL comes from the (separate) store the hook fills
vi.mock("../media/use-media-ref-preview", () => ({
  useMediaRefPreview: (ref: { mediaId: string } | null) => (ref ? `https://signed.example/${ref.mediaId}.jpg` : null),
}));

const A = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const B = "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f";
const still = (id: string) => `https://signed.example/${id}.jpg`;
const gif = (id: string) => `https://signed.example/${id}/animated.gif`;

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

beforeEach(() => {
  stubMatchMedia(false);
  for (const id of [A, B]) setAnimatedPreview(id, null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const EN = { pause: "Pause animation", play: "Play animation" };
const AR = { pause: "إيقاف الحركة", play: "تشغيل الحركة" };

const background = (extra: Record<string, unknown> = {}) =>
  ({ kind: "media", media: { mediaId: A, decorative: true }, ...extra }) as Extract<SectionBackground, { kind: "media" }>;

describe("CanvasBackdrop — animated background", () => {
  it("plays the animation by default on the SAME structure, with the storefront's labelled control outside the aria-hidden layer", () => {
    setAnimatedPreview(A, gif(A));
    const { container } = render(<CanvasBackdrop background={background()} viewport="desktop" motionLabels={EN} />);
    const layer = container.querySelector("[data-sd-backdrop]")!;
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.querySelectorAll("picture > img")).toHaveLength(1);
    expect(layer.querySelector("img")?.getAttribute("src")).toBe(gif(A));
    const toggle = screen.getByRole("button", { name: "Pause animation" });
    expect(layer.contains(toggle)).toBe(false);
    expect(toggle.hasAttribute("data-motion-toggle")).toBe(true);
    expect(toggle.getAttribute("aria-pressed")).toBeNull(); // the label carries the state; not announced twice
  });

  it("pause returns to the still first frame, play resumes; the control is a real, keyboard-operable button", () => {
    setAnimatedPreview(A, gif(A));
    const { container } = render(<CanvasBackdrop background={background()} viewport="desktop" motionLabels={EN} />);
    const img = () => container.querySelector("[data-sd-backdrop] img")!.getAttribute("src");
    fireEvent.click(screen.getByRole("button", { name: "Pause animation" }));
    expect(img()).toBe(still(A));
    const play = screen.getByRole("button", { name: "Play animation" });
    expect(play.tagName).toBe("BUTTON");
    expect(play.getAttribute("type")).toBe("button");
    fireEvent.click(play);
    expect(img()).toBe(gif(A));
  });

  it("a static background is exactly what it was: the still, no control", () => {
    const { container } = render(<CanvasBackdrop background={background()} viewport="desktop" motionLabels={EN} />);
    expect(container.querySelector("[data-sd-backdrop] img")?.getAttribute("src")).toBe(still(A));
    expect(container.querySelector("[data-motion-toggle]")).toBeNull();
  });

  it("an editor who prefers reduced motion sees the still and no control (as a visitor does)", () => {
    stubMatchMedia(true);
    setAnimatedPreview(A, gif(A));
    const { container } = render(<CanvasBackdrop background={background()} viewport="desktop" motionLabels={EN} />);
    expect(container.querySelector("[data-sd-backdrop] img")?.getAttribute("src")).toBe(still(A));
    expect(container.querySelector("[data-motion-toggle]")).toBeNull();
  });

  it("an expired animation URL falls back to the still instead of a broken picture", () => {
    setAnimatedPreview(A, gif(A));
    const { container } = render(<CanvasBackdrop background={background()} viewport="desktop" motionLabels={EN} />);
    fireEvent.error(container.querySelector("[data-sd-backdrop] img")!);
    expect(container.querySelector("[data-sd-backdrop] img")?.getAttribute("src")).toBe(still(A));
    expect(screen.getByRole("button", { name: "Play animation" })).toBeTruthy();
  });

  it("the phone picture is chosen from the simulated device, and the control follows the storefront rule (either picture animated)", () => {
    setAnimatedPreview(B, gif(B));
    const withPhone = background({ mobile: { mediaId: B, decorative: true } });
    const phone = render(<CanvasBackdrop background={withPhone} viewport="mobile" motionLabels={EN} />);
    expect(phone.container.querySelector("[data-sd-backdrop] img")?.getAttribute("src")).toBe(gif(B));
    cleanup();
    const desktop = render(<CanvasBackdrop background={withPhone} viewport="desktop" motionLabels={EN} />);
    expect(desktop.container.querySelector("[data-sd-backdrop] img")?.getAttribute("src")).toBe(still(A));
    expect(screen.getByRole("button", { name: "Pause animation" })).toBeTruthy();
  });

  it("Arabic labels and logical (RTL-safe) placement", () => {
    setAnimatedPreview(A, gif(A));
    render(
      <div dir="rtl">
        <CanvasBackdrop background={background()} viewport="desktop" motionLabels={AR} />
      </div>,
    );
    const toggle = screen.getByRole("button", { name: "إيقاف الحركة" });
    expect(toggle.style.insetInlineEnd).toBe("0.75rem");
    expect(toggle.style.insetBlockEnd).toBe("0.75rem");
    expect(toggle.style.left).toBe("");
    expect(toggle.style.right).toBe("");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "تشغيل الحركة" })).toBeTruthy();
  });

  it("without labels (a caller that predates animated media) nothing changes: the still, no control", () => {
    setAnimatedPreview(A, gif(A));
    const { container } = render(<CanvasBackdrop background={background()} viewport="desktop" />);
    expect(container.querySelector("[data-motion-toggle]")).toBeNull();
  });
});

const labels: CanvasSliderLabels = {
  label: "Featured slides",
  slide: "{current} of {total}",
  previous: "Previous slide",
  next: "Next slide",
  goTo: "Go to slide {number}",
  empty: "Add at least two slides",
  autoplayNote: "Autoplay does not run in the preview.",
  motion: EN,
};
const ctx = (dir: "ltr" | "rtl" = "ltr"): DesignContext => ({
  primaryColor: "#12372a",
  accentColor: null,
  dir,
  mediaBounds: () => ({ min: [10, 12, 14], max: [40, 50, 60] }),
});
const slide = (id: string, mediaId: string) => ({ id, media: { mediaId, decorative: true }, heading: `Heading ${id}` }) as never;
const mountSlider = (slides: never[], extra: Partial<React.ComponentProps<typeof CanvasSlider>> = {}) =>
  render(<CanvasSlider slides={slides} behaviour={undefined} context={ctx()} viewport="desktop" labels={labels} {...extra} />);
const imgs = (container: HTMLElement) => [...container.querySelectorAll("[data-slider-slide]")].map((s) => s.querySelector("img")?.getAttribute("src") ?? null);

describe("CanvasSlider — animated slides", () => {
  it("puts the motion control first in the existing bar (before the dots) and plays only the active slide", () => {
    setAnimatedPreview(A, gif(A));
    setAnimatedPreview(B, gif(B));
    const { container } = mountSlider([slide("a", A), slide("b", B)]);
    const bar = container.querySelector("[data-slider-bar]")!;
    expect(bar.firstElementChild?.hasAttribute("data-motion-toggle")).toBe(true);
    expect(bar.querySelector("[data-slider-dots]")).not.toBeNull();
    expect(imgs(container)).toEqual([gif(A), still(B)]);
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(imgs(container)).toEqual([still(A), gif(B)]);
  });

  it("pause stops it everywhere (back to the stills) and play resumes it; browsing the slides does not touch the choice", () => {
    setAnimatedPreview(A, gif(A));
    const { container } = mountSlider([slide("a", A), slide("b", B)]);
    fireEvent.click(screen.getByRole("button", { name: "Pause animation" }));
    expect(imgs(container)).toEqual([still(A), still(B)]);
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(screen.getByRole("button", { name: "Play animation" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Play animation" }));
    expect(imgs(container)).toEqual([still(A), still(B)]); // slide 2 is static, slide 1 is inactive
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(imgs(container)).toEqual([gif(A), still(B)]);
  });

  it("a slider with no animation renders exactly the markup it did before: no toggle, no extra bar", () => {
    const { container } = mountSlider([slide("a", A), slide("b", B)], { behaviour: { dots: false } as never });
    expect(container.querySelector("[data-motion-toggle]")).toBeNull();
    expect(container.querySelector("[data-slider-bar]")).toBeNull();
    expect(imgs(container)).toEqual([still(A), still(B)]);
  });

  it("an animated slide with dots off still gets the control (the bar carries it alone), as on the storefront", () => {
    setAnimatedPreview(A, gif(A));
    const { container } = mountSlider([slide("a", A), slide("b", B)], { behaviour: { dots: false } as never });
    const bar = container.querySelector("[data-slider-bar]")!;
    expect(bar.querySelector("[data-motion-toggle]")).not.toBeNull();
    expect(bar.querySelector("[data-slider-dots]")).toBeNull();
  });

  it("reduced motion: stills only and no control", () => {
    stubMatchMedia(true);
    setAnimatedPreview(A, gif(A));
    const { container } = mountSlider([slide("a", A), slide("b", B)]);
    expect(container.querySelector("[data-motion-toggle]")).toBeNull();
    expect(imgs(container)).toEqual([still(A), still(B)]);
  });

  it("Arabic labels in an RTL slider", () => {
    setAnimatedPreview(A, gif(A));
    const { container } = mountSlider([slide("a", A), slide("b", B)], { context: ctx("rtl"), labels: { ...labels, motion: AR } });
    expect(container.querySelector("[data-slider]")?.getAttribute("dir")).toBe("rtl");
    fireEvent.click(screen.getByRole("button", { name: "إيقاف الحركة" }));
    expect(screen.getByRole("button", { name: "تشغيل الحركة" })).toBeTruthy();
  });

  it("an expired animation falls back to the still of that slide", () => {
    setAnimatedPreview(A, gif(A));
    const { container } = mountSlider([slide("a", A), slide("b", B)]);
    fireEvent.error(container.querySelector("[data-slider-slide] img")!);
    expect(imgs(container)[0]).toBe(still(A));
  });

  it("the control appears when the animated URL arrives after the first paint, and goes when the slide is removed", async () => {
    const { container, rerender } = mountSlider([slide("a", A), slide("b", B)]);
    expect(container.querySelector("[data-motion-toggle]")).toBeNull();
    await act(async () => setAnimatedPreview(A, gif(A)));
    expect(container.querySelector("[data-motion-toggle]")).not.toBeNull();
    rerender(<CanvasSlider slides={[slide("b", B), slide("c", B)]} behaviour={undefined} context={ctx()} viewport="desktop" labels={labels} />);
    expect(container.querySelector("[data-motion-toggle]")).toBeNull();
  });

  it("a caller without motion labels (predates animated media) gets no control", () => {
    setAnimatedPreview(A, gif(A));
    const { motion: _omit, ...legacy } = labels;
    const { container } = mountSlider([slide("a", A), slide("b", B)], { labels: legacy });
    expect(container.querySelector("[data-motion-toggle]")).toBeNull();
  });
});

describe("Canvas ↔ storefront mirror guards", () => {
  const storefront = (rel: string) => readFileSync(resolve(__dirname, "../../../../../storefront/src", rel), "utf8");

  it("the backdrop control's inline look is the storefront's MOTION_TOGGLE_STYLE, value for value", () => {
    const source = storefront("components/ui/motion-picture.tsx");
    const block = source.slice(source.indexOf("export const MOTION_TOGGLE_STYLE"));
    for (const [key, value] of Object.entries(CANVAS_MOTION_TOGGLE_STYLE)) {
      expect(block, `${key}`).toMatch(new RegExp(`${key}: ${typeof value === "number" ? value : `"${String(value).replace(/[()]/g, "\\$&")}"`}`));
    }
  });

  it("the control has a two-tone focus ring in BOTH stylesheets (the global 1px outline vanishes on a dark picture)", () => {
    const canvas = readFileSync(resolve(__dirname, "../store-preview.css"), "utf8");
    expect(storefront("app/globals.css")).toMatch(/\[data-motion-toggle\]:focus-visible\s*\{\s*outline: 2px solid #fff;/);
    expect(canvas).toMatch(/\.awj-store-preview \[data-motion-toggle\]:focus-visible\s*\{\s*outline: 2px solid #fff;/);
  });
});

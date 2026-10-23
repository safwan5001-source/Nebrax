/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANVAS_MOTION_BUDGET_MS, CanvasGallery, type CanvasGalleryLabels } from "../CanvasGallery";
import { setAnimatedPreview } from "../media/animated-preview-store";

/**
 * AWJ-ANIMATED-MEDIA — the Canvas's gallery plays the signed sanitised animation like the published page and follows the same WCAG 2.2.2
 * policy: `showMotionControls` ⇒ one pause / play control for the gallery; otherwise no control and a bounded play window.
 */

vi.mock("../media/use-media-ref-preview", () => ({
  useMediaRefPreview: (ref: { mediaId: string } | null) => (ref ? `https://signed.example/${ref.mediaId}.jpg` : null),
}));

const A = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const B = "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f";
const C = "2d0b8e4a-5f5c-4c75-9e9a-ab3c4d5e6f70";
const still = (id: string) => `https://signed.example/${id}.jpg`;
const gif = (id: string) => `https://signed.example/${id}/animated.gif`;

const labels: CanvasGalleryLabels = {
  label: "Gallery",
  empty: "Add at least two pictures",
  item: "Picture {number}",
  motion: { pause: "Pause animation", play: "Play animation" },
};
const images = [
  { id: "a", media: { mediaId: A } },
  { id: "b", media: { mediaId: B } },
  { id: "c", media: { mediaId: C } },
] as never;

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

const mount = (options?: Record<string, unknown>) =>
  render(
    <CanvasGallery images={images} options={options as never} layout="grid" dir="ltr" viewport="desktop" labels={labels} />,
  );
const srcs = (root: ParentNode) => [...root.querySelectorAll("img")].map((i) => i.getAttribute("src"));

beforeEach(() => {
  stubMatchMedia(false);
  for (const id of [A, B, C]) setAnimatedPreview(id, null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CanvasGallery — animated pictures", () => {
  it("plays an animated picture on the SAME <picture><img>, leaves the still ones, and draws no control by default", () => {
    setAnimatedPreview(A, gif(A));
    const { container } = mount();
    expect(srcs(container)).toEqual([gif(A), still(B), still(C)]);
    expect(container.querySelector("[data-gallery-motion]")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a gallery with no animated picture is unchanged, even with the preference on", () => {
    const { container } = mount({ showMotionControls: true });
    expect(srcs(container)).toEqual([still(A), still(B), still(C)]);
    expect(container.querySelector("[data-gallery-motion]")).toBeNull();
  });

  it("showMotionControls: ONE labelled control pauses and resumes every animated picture; nothing auto-settles", () => {
    vi.useFakeTimers();
    setAnimatedPreview(A, gif(A));
    setAnimatedPreview(B, gif(B));
    const { container } = mount({ showMotionControls: true });
    expect(screen.getAllByRole("button", { name: "Pause animation" })).toHaveLength(1);
    expect(container.querySelector("[data-gallery-motion]")?.querySelector("[data-motion-toggle]")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(CANVAS_MOTION_BUDGET_MS * 3);
    });
    expect(srcs(container)).toEqual([gif(A), gif(B), still(C)]);

    fireEvent.click(screen.getByRole("button", { name: "Pause animation" }));
    expect(srcs(container)).toEqual([still(A), still(B), still(C)]);
    fireEvent.click(screen.getByRole("button", { name: "Play animation" }));
    expect(srcs(container)).toEqual([gif(A), gif(B), still(C)]);
  });

  it("without the control each animated picture plays the bounded window, then settles on its still", () => {
    vi.useFakeTimers();
    setAnimatedPreview(A, gif(A));
    const { container } = mount();
    act(() => {
      vi.advanceTimersByTime(CANVAS_MOTION_BUDGET_MS - 1);
    });
    expect(srcs(container)[0]).toBe(gif(A));
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(srcs(container)[0]).toBe(still(A));
    expect(CANVAS_MOTION_BUDGET_MS).toBe(5000);
  });

  it("reduced motion: stills only, and no control even when the preference is on", () => {
    stubMatchMedia(true);
    setAnimatedPreview(A, gif(A));
    const { container } = mount({ showMotionControls: true });
    expect(srcs(container)).toEqual([still(A), still(B), still(C)]);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a stale signed animation falls back to the still instead of leaving a broken picture", () => {
    setAnimatedPreview(A, gif(A));
    const { container } = mount();
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(srcs(container)[0]).toBe(still(A));
  });
});

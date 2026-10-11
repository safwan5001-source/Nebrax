/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasSlider, type CanvasSliderLabels } from "../CanvasSlider";
import type { DesignContext } from "../presentation/section-design-resolve";

// the signed workspace preview URL is the editor's only picture source; the bounds are the editor's read-only proof
vi.mock("../media/use-media-ref-preview", () => ({
  useMediaRefPreview: (ref: { mediaId: string } | null) => (ref ? `https://signed.example/${ref.mediaId}.jpg` : null),
}));

afterEach(cleanup);

const A = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const B = "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f";
const labels: CanvasSliderLabels = {
  label: "Featured slides",
  slide: "{current} of {total}",
  previous: "Previous slide",
  next: "Next slide",
  goTo: "Go to slide {number}",
  empty: "Add at least two slides",
  autoplayNote: "Autoplay does not run in the preview.",
};
const ctx = (dir: "ltr" | "rtl" = "ltr", proven: string[] = [A]): DesignContext => ({
  primaryColor: "#12372a",
  accentColor: null,
  dir,
  mediaBounds: (ref) => (proven.includes(ref.mediaId) ? { min: [10, 12, 14], max: [40, 50, 60] } : null),
});
const slide = (id: string, mediaId = A, extra: Record<string, unknown> = {}) =>
  ({ id, media: { mediaId, decorative: true }, heading: `Heading ${id}`, ...extra }) as never;

function mount(slides: never[], extra: Partial<React.ComponentProps<typeof CanvasSlider>> = {}) {
  return render(
    <CanvasSlider slides={slides} behaviour={undefined} context={ctx()} viewport="desktop" labels={labels} {...extra} />,
  );
}
const active = () => [...document.querySelectorAll("[data-slider-slide]")].findIndex((s) => s.hasAttribute("data-active"));

describe("CanvasSlider (CUST-HV V8c)", () => {
  it("draws the storefront's DOM: a named carousel, slides as 'n of N' groups, only the active one exposed, the device on data-vp", () => {
    const { container } = mount([slide("a"), slide("b"), slide("c")], { viewport: "tablet" });
    const root = container.querySelector("[data-slider]")!;
    expect(root.getAttribute("aria-roledescription")).toBe("carousel");
    expect(root.getAttribute("aria-label")).toBe("Featured slides");
    expect(root.getAttribute("data-vp")).toBe("tablet");
    const slides = [...root.querySelectorAll("[data-slider-slide]")];
    expect(slides.map((s) => s.getAttribute("aria-label"))).toEqual(["1 of 3", "2 of 3", "3 of 3"]);
    // (`inert` is asserted in the real-browser spec: this workspace's unit tests run React 18, which drops the boolean attribute, while the
    // Canvas itself renders under the Next App Router's React 19)
    expect(slides.map((s) => s.getAttribute("aria-hidden"))).toEqual([null, "true", "true"]);
  });

  it("a proven picture shows with the proven colour; unproven copy withholds the picture for the brand surface", () => {
    const { container } = mount([slide("a", A), slide("b", B)]);
    const [a, b] = [...container.querySelectorAll<HTMLElement>("[data-slider-slide]")];
    expect(a.dataset.surface).toBe("picture");
    expect(a.querySelector("img")?.getAttribute("src")).toBe(`https://signed.example/${A}.jpg`);
    expect(a.style.getPropertyValue("--sl-fg")).toBe("#ffffff");
    expect(b.dataset.surface).toBe("brand");
    expect(b.querySelector("img")).toBeNull();
  });

  it("the phone picture is chosen from the simulated device, not the host window", () => {
    const withPhone = slide("a", A, { mobile: { mediaId: B, decorative: true } });
    const phone = mount([withPhone, slide("b")], { viewport: "mobile", context: ctx("ltr", [A, B]) });
    expect(phone.container.querySelector("img")?.getAttribute("src")).toBe(`https://signed.example/${B}.jpg`);
    cleanup();
    const desktop = mount([withPhone, slide("b")], { viewport: "desktop", context: ctx("ltr", [A, B]) });
    expect(desktop.container.querySelector("img")?.getAttribute("src")).toBe(`https://signed.example/${A}.jpg`);
  });

  it("arrows and dots browse the slides; the ends clamp without looping and wrap with it", () => {
    mount([slide("a"), slide("b"), slide("c")]);
    expect(screen.getByRole("button", { name: "Previous slide" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(active()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Go to slide 3" }));
    expect(active()).toBe(2);
    expect(screen.getByRole("button", { name: "Go to slide 3" }).getAttribute("aria-current")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(active()).toBe(2);
    cleanup();
    mount([slide("a"), slide("b"), slide("c")], { behaviour: { loop: true } });
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(active()).toBe(2);
  });

  it("arrows, dots and the transition follow the behaviour; autoplay is only announced, never run", () => {
    const { container } = mount([slide("a"), slide("b")], {
      behaviour: { arrows: false, dots: false, transition: "fade", duration: "slow", autoplay: true },
    });
    expect(container.querySelector("[data-slider-arrow]")).toBeNull();
    expect(container.querySelector("[data-slider-dots]")).toBeNull();
    const root = container.querySelector("[data-slider]")!;
    expect(root.getAttribute("data-transition")).toBe("fade");
    expect(root.getAttribute("data-duration")).toBe("slow");
    expect(container.querySelector("[data-slider-note]")?.textContent).toBe("Autoplay does not run in the preview.");
    expect(container.querySelector("[data-slider-pause]")).toBeNull();
  });

  it("the editor's selected slide is the one shown", () => {
    mount([slide("a"), slide("b"), slide("c")], { activeSlideId: "c" });
    expect(active()).toBe(2);
  });

  it("direction follows the page; a single slide has no controls; no slides says what is needed", () => {
    const rtl = mount([slide("a"), slide("b")], { context: ctx("rtl") });
    expect(rtl.container.querySelector("[data-slider]")?.getAttribute("dir")).toBe("rtl");
    cleanup();
    const single = mount([slide("a")]);
    expect(single.container.querySelectorAll("button")).toHaveLength(0);
    cleanup();
    mount([]);
    expect(screen.getByText("Add at least two slides")).toBeTruthy();
    expect(document.querySelector("[data-slider]")).toBeNull();
  });

  it("the button is only the slide's complete label + link, drawn as a non-link span", () => {
    const { container } = mount([
      slide("a", A, { cta: { label: "Shop", href: "/c/x" } }),
      slide("b", A, { cta: { label: "Draft", href: "" } }),
    ]);
    const buttons = container.querySelectorAll("[data-slider-cta]");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe("Shop");
    expect(buttons[0].tagName).toBe("SPAN");
  });
});

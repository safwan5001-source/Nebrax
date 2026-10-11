import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeSlider, type SliderLabels } from "@/components/home/HomeSlider";
import type { ResolvedMedia } from "@/lib/presentation/media-ref";
import { resolveSliderBehaviour } from "@/lib/presentation/slider-content";
import type { SliderView, SlideView } from "@/lib/presentation/slider-resolve";

const labels: SliderLabels = {
  label: "Featured slides",
  slide: "{current} of {total}",
  previous: "Previous slide",
  next: "Next slide",
  goTo: "Go to slide {number}",
  pause: "Pause slides",
  play: "Play slides",
  choose: "Choose a slide",
};

const picture = (id: string): ResolvedMedia => ({
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
      src: `/api/storefront/media/customizer/${id}/w800.webp`,
    },
    {
      kind: "w",
      width: 800,
      height: 450,
      format: "jpg",
      src: `/api/storefront/media/customizer/${id}/w800.jpg`,
    },
  ],
});

function slide(i: number, extra: Partial<SlideView> = {}): SlideView {
  return {
    id: `s${i}`,
    position: i + 1,
    media: picture(`m${i}`),
    mobile: null,
    alt: `Alt ${i + 1}`,
    heading: `Heading ${i + 1}`,
    sub: "",
    cta: null,
    foreground: "#ffffff",
    buttonLabel: "#000000",
    overlay: null,
    align: "start",
    surface: "picture",
    ...extra,
  };
}

function view(
  count = 3,
  behaviour: Parameters<typeof resolveSliderBehaviour>[0] = undefined,
  extra: (i: number) => Partial<SlideView> = () => ({}),
): SliderView {
  return {
    slides: Array.from({ length: count }, (_, i) => slide(i, extra(i))),
    behaviour: resolveSliderBehaviour(behaviour),
  };
}

function mount(
  v: SliderView,
  props: Partial<React.ComponentProps<typeof HomeSlider>> = {},
) {
  return render(
    <HomeSlider
      view={v}
      labels={labels}
      basePath="/sa/ar"
      dir="ltr"
      sectionId="sl"
      {...props}
    />,
  );
}

function stubMatchMedia(reduced: boolean) {
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduced && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    })),
  );
}

const slides = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-slider-slide]"));
const activeIndex = () =>
  slides().findIndex((s) => s.hasAttribute("data-active"));

beforeEach(() => {
  stubMatchMedia(false);
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "hidden");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("HomeSlider — server markup (progressive)", () => {
  it("renders slide 1 active and every other slide inert + hidden, with no controls", () => {
    const html = renderToString(
      <HomeSlider
        view={view(3)}
        labels={labels}
        basePath="/sa/ar"
        dir="ltr"
        sectionId="sl"
      />,
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    const all = [...host.querySelectorAll("[data-slider-slide]")];
    expect(all).toHaveLength(3);
    expect(all.map((s) => s.hasAttribute("data-active"))).toEqual([
      true,
      false,
      false,
    ]);
    expect(all.map((s) => s.hasAttribute("inert"))).toEqual([
      false,
      true,
      true,
    ]);
    expect(all.map((s) => s.getAttribute("aria-hidden"))).toEqual([
      null,
      "true",
      "true",
    ]);
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(
      host.querySelector("[data-slider]")?.getAttribute("aria-roledescription"),
    ).toBe("carousel");
    expect(
      host.querySelector("[data-slider]")?.getAttribute("aria-label"),
    ).toBe("Featured slides");
  });

  it("each slide is a named group 'n of N' with the slide role description", () => {
    mount(view(3));
    const groups = screen
      .getAllByRole("group", { hidden: true })
      .filter((g) => g.hasAttribute("data-slider-slide"));
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      "1 of 3",
      "2 of 3",
      "3 of 3",
    ]);
    expect(
      groups.every((g) => g.getAttribute("aria-roledescription") === "slide"),
    ).toBe(true);
  });

  it("only the first picture is eager, and only when the slider opens the page; all carry dimensions", () => {
    const { container, rerender } = mount(view(3), { priority: true });
    let imgs = [...container.querySelectorAll("img")];
    expect(imgs.map((i) => i.getAttribute("loading"))).toEqual([
      "eager",
      "lazy",
      "lazy",
    ]);
    expect(imgs[0].getAttribute("fetchpriority")).toBe("high");
    expect(
      imgs.every(
        (i) =>
          i.getAttribute("width") === "1600" &&
          i.getAttribute("height") === "900",
      ),
    ).toBe(true);
    rerender(
      <HomeSlider
        view={view(3)}
        labels={labels}
        basePath="/sa/ar"
        dir="ltr"
        sectionId="sl"
      />,
    );
    imgs = [...container.querySelectorAll("img")];
    expect(imgs.map((i) => i.getAttribute("loading"))).toEqual([
      "lazy",
      "lazy",
      "lazy",
    ]);
  });

  it("alt text comes from the resolved view; the phone picture is an art-direction source", () => {
    const v = view(1, undefined, () => ({
      mobile: picture("phone"),
      alt: "Roses",
    }));
    const { container } = mount(v);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("Roses");
    const sources = [...container.querySelectorAll("source")];
    expect(sources[0].getAttribute("media")).toBe("(max-width: 767px)");
    expect(sources[0].getAttribute("srcset")).toContain("/phone/");
    expect(sources.at(-1)?.getAttribute("media")).toBeNull();
  });

  it("a withheld picture draws the brand surface with its copy and no picture", () => {
    const { container } = mount(
      view(1, undefined, () => ({ media: null, surface: "brand" as const })),
    );
    expect(container.querySelector("img")).toBeNull();
    expect(
      container.querySelector('[data-slider-slide][data-surface="brand"]'),
    ).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Heading 1" })).toBeTruthy();
  });

  it("colours reach the slide only as validated custom properties", () => {
    const { container } = mount(
      view(1, undefined, () => ({
        overlay: { colour: "#112233", alpha: 0.4 },
      })),
    );
    const el = container.querySelector<HTMLElement>("[data-slider-slide]")!;
    expect(el.style.getPropertyValue("--sl-fg")).toBe("#ffffff");
    expect(el.style.getPropertyValue("--sl-btn")).toBe("#000000");
    expect(el.style.getPropertyValue("--sl-ovl")).toBe("#112233");
    expect(el.style.getPropertyValue("--sl-ovl-a")).toBe("0.4");
    expect(container.querySelector("[data-slider-wash]")).not.toBeNull();
  });

  it("the button is a real link, resolved under the store base path; an unsafe or empty target draws none", () => {
    const { container } = mount(
      view(2, undefined, (i) => ({
        cta:
          i === 0
            ? { label: "Shop", href: "/c/roses" }
            : { label: "Bad", href: "javascript:alert(1)" },
      })),
    );
    const links =
      container.querySelectorAll<HTMLAnchorElement>("a[data-slider-cta]");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/sa/ar/c/roses");
    expect(links[0].textContent).toBe("Shop");
  });
});

describe("HomeSlider — controls and navigation", () => {
  it("controls appear only after hydration and only for more than one slide", () => {
    mount(view(3));
    expect(screen.getByRole("button", { name: "Next slide" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous slide" })).toBeTruthy();
    cleanup();
    const { container } = mount(view(1));
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("next / previous / dots move the active slide; only the active one is exposed", () => {
    mount(view(3, { loop: true }));
    expect(activeIndex()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(activeIndex()).toBe(1);
    expect(slides().map((s) => s.hasAttribute("inert"))).toEqual([
      true,
      false,
      true,
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Go to slide 3" }));
    expect(activeIndex()).toBe(2);
    expect(
      screen
        .getByRole("button", { name: "Go to slide 3" })
        .getAttribute("aria-current"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "Go to slide 1" })
        .getAttribute("aria-current"),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(activeIndex()).toBe(0); // loop wraps
    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(activeIndex()).toBe(2);
  });

  it("without loop the ends clamp and the arrow says so (aria-disabled, still focusable)", () => {
    mount(view(2));
    const prev = screen.getByRole("button", { name: "Previous slide" });
    expect(prev.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(prev);
    expect(activeIndex()).toBe(0);
    const next = screen.getByRole("button", { name: "Next slide" });
    fireEvent.click(next);
    expect(activeIndex()).toBe(1);
    expect(next.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(next);
    expect(activeIndex()).toBe(1);
  });

  it("arrows and dots can be switched off", () => {
    const { container } = mount(view(3, { arrows: false, dots: false }));
    expect(container.querySelector("[data-slider-arrow]")).toBeNull();
    expect(container.querySelector("[data-slider-dots]")).toBeNull();
  });

  it("keyboard: → goes forward in LTR, ← goes forward in RTL; Home / End jump", () => {
    const { container, unmount } = mount(view(4, { loop: true }));
    const root = container.querySelector("[data-slider]")!;
    fireEvent.keyDown(root, { key: "ArrowRight" });
    expect(activeIndex()).toBe(1);
    fireEvent.keyDown(root, { key: "ArrowLeft" });
    expect(activeIndex()).toBe(0);
    fireEvent.keyDown(root, { key: "End" });
    expect(activeIndex()).toBe(3);
    fireEvent.keyDown(root, { key: "Home" });
    expect(activeIndex()).toBe(0);
    unmount();

    const rtl = mount(view(4, { loop: true }), { dir: "rtl" });
    const rtlRoot = rtl.container.querySelector("[data-slider]")!;
    expect(rtlRoot.getAttribute("dir")).toBe("rtl");
    fireEvent.keyDown(rtlRoot, { key: "ArrowLeft" });
    expect(activeIndex()).toBe(1);
    fireEvent.keyDown(rtlRoot, { key: "ArrowRight" });
    expect(activeIndex()).toBe(0);
  });

  it("an unrelated key is left alone", () => {
    const { container } = mount(view(3));
    const root = container.querySelector("[data-slider]")!;
    const notPrevented = fireEvent.keyDown(root, { key: "a" });
    expect(notPrevented).toBe(true);
    expect(activeIndex()).toBe(0);
  });

  function swipe(
    el: Element,
    from: number,
    to: number,
    type = "touch",
    dy = 0,
  ) {
    fireEvent.pointerDown(el, {
      pointerId: 1,
      pointerType: type,
      clientX: from,
      clientY: 100,
    });
    fireEvent.pointerUp(el, {
      pointerId: 1,
      pointerType: type,
      clientX: to,
      clientY: 100 + dy,
    });
  }

  it("a swipe toward the inline-start edge goes forward: leftwards in LTR, rightwards in RTL", () => {
    const ltr = mount(view(3, { loop: true }));
    const vp = ltr.container.querySelector("[data-slider-viewport]")!;
    swipe(vp, 300, 100);
    expect(activeIndex()).toBe(1);
    swipe(vp, 100, 300);
    expect(activeIndex()).toBe(0);
    ltr.unmount();

    const rtl = mount(view(3, { loop: true }), { dir: "rtl" });
    const rvp = rtl.container.querySelector("[data-slider-viewport]")!;
    swipe(rvp, 100, 300);
    expect(activeIndex()).toBe(1);
    swipe(rvp, 300, 100);
    expect(activeIndex()).toBe(0);
  });

  it("a short or mostly-vertical drag, or a mouse drag, does not move the slide", () => {
    const { container } = mount(view(3, { loop: true }));
    const vp = container.querySelector("[data-slider-viewport]")!;
    swipe(vp, 200, 180);
    swipe(vp, 300, 100, "touch", 400);
    swipe(vp, 300, 100, "mouse");
    expect(activeIndex()).toBe(0);
  });

  it("the live region is polite when nothing autoplays", () => {
    const { container } = mount(view(3));
    expect(
      container.querySelector("[data-slider-track]")?.getAttribute("aria-live"),
    ).toBe("polite");
  });
});

describe("HomeSlider — autoplay (D-16)", () => {
  const auto = (extra = {}) => ({ autoplay: true as const, ...extra });

  it("is off by default: nothing advances and there is no pause control", () => {
    vi.useFakeTimers();
    mount(view(3));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(activeIndex()).toBe(0);
    expect(screen.queryByRole("button", { name: "Pause slides" })).toBeNull();
  });

  it("advances every interval (6 s by default), restarts the interval after a manual move, and the live region is off while it runs", () => {
    vi.useFakeTimers();
    const { container } = mount(view(3, auto({ loop: true })));
    expect(
      container.querySelector("[data-slider-track]")?.getAttribute("aria-live"),
    ).toBe("off");
    act(() => {
      vi.advanceTimersByTime(5_900);
    });
    expect(activeIndex()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(activeIndex()).toBe(1);
    // a manual move re-arms the full interval
    fireEvent.click(screen.getByRole("button", { name: "Go to slide 3" }));
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(activeIndex()).toBe(2);
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(activeIndex()).toBe(0);
  });

  it("honours a custom interval", () => {
    vi.useFakeTimers();
    mount(view(3, auto({ interval: 10, loop: true })));
    act(() => {
      vi.advanceTimersByTime(9_900);
    });
    expect(activeIndex()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(activeIndex()).toBe(1);
  });

  it("a visible Pause button stops it; Play resumes", () => {
    vi.useFakeTimers();
    mount(view(3, auto({ loop: true })));
    fireEvent.click(screen.getByRole("button", { name: "Pause slides" }));
    expect(screen.getByRole("button", { name: "Play slides" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(activeIndex()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Play slides" }));
    act(() => {
      vi.advanceTimersByTime(6_100);
    });
    expect(activeIndex()).toBe(1);
  });

  it("pauses while the pointer is over it and while focus is inside, and resumes after", () => {
    vi.useFakeTimers();
    const { container } = mount(view(3, auto({ loop: true })));
    const root = container.querySelector("[data-slider]")!;
    fireEvent.mouseEnter(root);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(activeIndex()).toBe(0);
    fireEvent.mouseLeave(root);
    act(() => {
      vi.advanceTimersByTime(6_100);
    });
    expect(activeIndex()).toBe(1);

    const next = screen.getByRole("button", { name: "Next slide" });
    fireEvent.focus(next);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(activeIndex()).toBe(1);
    fireEvent.blur(next, { relatedTarget: document.body });
    act(() => {
      vi.advanceTimersByTime(6_100);
    });
    expect(activeIndex()).toBe(2);
  });

  it("focus on the Pause / Play button itself does not hold the show: pressing Play starts it", () => {
    vi.useFakeTimers();
    mount(view(3, auto({ loop: true })));
    const pause = screen.getByRole("button", { name: "Pause slides" });
    fireEvent.focus(pause);
    fireEvent.click(pause); // paused
    fireEvent.click(screen.getByRole("button", { name: "Play slides" })); // playing again, focus still on the button
    act(() => {
      vi.advanceTimersByTime(6_100);
    });
    expect(activeIndex()).toBe(1);
  });

  it("tabbing from another control to the Pause / Play button clears the focus hold (Codex P2)", () => {
    vi.useFakeTimers();
    mount(view(3, auto({ loop: true })));
    const next = screen.getByRole("button", { name: "Next slide" });
    const pause = screen.getByRole("button", { name: "Pause slides" });
    fireEvent.focus(next); // the hold starts
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(activeIndex()).toBe(0);
    fireEvent.blur(next, { relatedTarget: pause }); // focus moves within the slider: still held…
    fireEvent.focus(pause); // …until it lands on the Pause / Play button
    act(() => {
      vi.advanceTimersByTime(6_100);
    });
    expect(activeIndex()).toBe(1);
  });

  it("Play at the end of a non-looping show restarts from the first slide (Codex P2)", () => {
    vi.useFakeTimers();
    mount(view(2, auto()));
    act(() => {
      vi.advanceTimersByTime(6_100);
    });
    act(() => {
      vi.advanceTimersByTime(6_100);
    });
    expect(activeIndex()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Play slides" }));
    expect(activeIndex()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(6_100);
    });
    expect(activeIndex()).toBe(1);
  });

  it("the first touch pauses it for good until Play is pressed", () => {
    vi.useFakeTimers();
    const { container } = mount(view(3, auto({ loop: true })));
    const vp = container.querySelector("[data-slider-viewport]")!;
    fireEvent.pointerDown(vp, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerUp(vp, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 10,
      clientY: 10,
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(activeIndex()).toBe(0);
    expect(screen.getByRole("button", { name: "Play slides" })).toBeTruthy();
  });

  it("pauses while the tab is hidden", () => {
    vi.useFakeTimers();
    mount(view(3, auto({ loop: true })));
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(activeIndex()).toBe(0);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      vi.advanceTimersByTime(6_100);
    });
    expect(activeIndex()).toBe(1);
  });

  it("without loop it ends on the last slide and offers Play", () => {
    vi.useFakeTimers();
    mount(view(2, auto()));
    act(() => {
      vi.advanceTimersByTime(6_100);
    });
    expect(activeIndex()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(6_100);
    });
    expect(activeIndex()).toBe(1);
    expect(screen.getByRole("button", { name: "Play slides" })).toBeTruthy();
  });

  it("prefers-reduced-motion disables autoplay entirely: no timer, no pause control, and the root says so", () => {
    stubMatchMedia(true);
    vi.useFakeTimers();
    const { container } = mount(view(3, auto({ loop: true })));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(activeIndex()).toBe(0);
    expect(screen.queryByRole("button", { name: /slides$/ })).toBeNull();
    expect(
      container.querySelector("[data-slider]")?.getAttribute("data-motion"),
    ).toBe("reduced");
    // manual navigation still works
    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(activeIndex()).toBe(1);
  });

  it("exposes the transition and duration tokens as attributes", () => {
    const { container } = mount(
      view(2, { transition: "fade", duration: "slow" }),
    );
    const root = container.querySelector("[data-slider]")!;
    expect(root.getAttribute("data-transition")).toBe("fade");
    expect(root.getAttribute("data-duration")).toBe("slow");
  });

  it("the controls group is named and every dot is a labelled button", () => {
    mount(view(3));
    const group = screen.getByRole("group", { name: "Choose a slide" });
    expect(within(group).getAllByRole("button")).toHaveLength(3);
  });
});

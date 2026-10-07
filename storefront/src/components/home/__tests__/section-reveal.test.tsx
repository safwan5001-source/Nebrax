/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SectionReveal } from "../SectionReveal";

type Callback = (entries: Array<Partial<IntersectionObserverEntry>>) => void;

let observers: Array<{
  callback: Callback;
  observed: Element[];
  unobserved: Element[];
  disconnected: boolean;
}> = [];

function install({ reducedMotion = false, withObserver = true } = {}) {
  observers = [];
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reducedMotion && query.includes("reduce"),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  if (withObserver) {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        record = {
          callback: null as unknown as Callback,
          observed: [] as Element[],
          unobserved: [] as Element[],
          disconnected: false,
        };
        constructor(callback: Callback) {
          this.record.callback = callback;
          observers.push(this.record);
        }
        observe(el: Element) {
          this.record.observed.push(el);
        }
        unobserve(el: Element) {
          this.record.unobserved.push(el);
        }
        disconnect() {
          this.record.disconnected = true;
        }
      },
    );
  } else {
    vi.stubGlobal("IntersectionObserver", undefined);
  }
}

function section(id: string, top: number) {
  const el = document.createElement("div");
  el.id = id;
  el.setAttribute("data-sd", "reveal");
  el.getBoundingClientRect = () => ({ top }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SectionReveal (CUST-HV V5e-3)", () => {
  it("renders nothing", () => {
    install();
    const { container } = render(<SectionReveal />);
    expect(container.innerHTML).toBe("");
  });

  it("never touches a section that is already in the viewport (nothing above the fold is hidden)", () => {
    install();
    const inView = section("a", 120);
    const below = section("b", 1400);
    render(<SectionReveal />);
    expect(inView.hasAttribute("data-reveal")).toBe(false);
    expect(below.getAttribute("data-reveal")).toBe("wait");
    expect(observers[0].observed).toEqual([below]);
  });

  it("reveals a below-the-fold section once, then stops observing it", () => {
    install();
    const below = section("b", 1400);
    render(<SectionReveal />);
    observers[0].callback([{ target: below, isIntersecting: false }]);
    expect(below.getAttribute("data-reveal")).toBe("wait");
    observers[0].callback([{ target: below, isIntersecting: true }]);
    expect(below.getAttribute("data-reveal")).toBe("in");
    expect(observers[0].unobserved).toEqual([below]);
  });

  it("does nothing under prefers-reduced-motion", () => {
    install({ reducedMotion: true });
    const below = section("b", 1400);
    render(<SectionReveal />);
    expect(below.hasAttribute("data-reveal")).toBe(false);
    expect(observers).toHaveLength(0);
  });

  it("does nothing without IntersectionObserver (every section stays visible)", () => {
    install({ withObserver: false });
    const below = section("b", 1400);
    render(<SectionReveal />);
    expect(below.hasAttribute("data-reveal")).toBe(false);
  });

  it("creates no observer when no section is below the fold, and cleans up on unmount", () => {
    install();
    section("a", 100);
    const view = render(<SectionReveal />);
    expect(observers).toHaveLength(0);
    view.unmount();

    const below = section("c", 2000);
    const again = render(<SectionReveal />);
    expect(below.getAttribute("data-reveal")).toBe("wait");
    again.unmount();
    expect(observers[0].disconnected).toBe(true);
    expect(below.hasAttribute("data-reveal")).toBe(false);
  });
});

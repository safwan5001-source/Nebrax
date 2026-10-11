import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OVERLAY_SOLID_AT_PX } from "@/lib/presentation/header-design";
import { HeaderOverlay } from "../HeaderOverlay";

function scrollTo(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
    vi.runAllTimers();
  });
}

function mount(sticky = true) {
  // measured at mount, so the geometry must exist before the tree does
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        height:
          this.tagName === "DIV" && this.hasAttribute("data-band")
            ? 64.4
            : this.tagName === "NAV"
              ? 38
              : 0,
      } as DOMRect;
    },
  );
  const view = render(
    <div data-testid="wrapper">
      <header>
        <HeaderOverlay sticky={sticky} />
        <div data-band="">top</div>
        <nav data-band="">rail</nav>
        <input aria-label="search" />
        <button type="button" data-toggle="">
          menu
        </button>
      </header>
    </div>,
  );
  const header = view.container.querySelector("header") as HTMLElement;
  const wrapper = view.getByTestId("wrapper");
  for (const [i, band] of Array.from(
    header.querySelectorAll("[data-band]"),
  ).entries()) {
    (band as HTMLElement).getBoundingClientRect = () =>
      ({ height: i === 0 ? 64.4 : 38 }) as DOMRect;
  }
  return { ...view, header, wrapper };
}

describe("HeaderOverlay controller (V7c-2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback) =>
        setTimeout(() => cb(0), 0) as unknown as number,
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.removeAttribute("data-scroll-locked");
  });

  it("goes live (sticky) only when the design allows sticky, and starts transparent", () => {
    const sticky = mount(true);
    expect(sticky.header.hasAttribute("data-header-live")).toBe(true);
    expect(sticky.header.hasAttribute("data-header-solid")).toBe(false);
    sticky.unmount();
    const off = mount(false);
    expect(off.header.hasAttribute("data-header-live")).toBe(false);
  });

  it("publishes the bands' height as --hd-block on the wrapper", () => {
    const { wrapper } = mount();
    // 64.4 + 38 rounded up
    expect(wrapper.style.getPropertyValue("--hd-block")).toBe("103px");
  });

  it("turns solid past the threshold and transparent again at the top", () => {
    const { header } = mount();
    scrollTo(OVERLAY_SOLID_AT_PX);
    expect(header.hasAttribute("data-header-solid")).toBe(false);
    scrollTo(OVERLAY_SOLID_AT_PX + 1);
    expect(header.hasAttribute("data-header-solid")).toBe(true);
    scrollTo(0);
    expect(header.hasAttribute("data-header-solid")).toBe(false);
  });

  it("turns solid the moment focus enters, an expanded control opens, or a dialog locks the page", async () => {
    const { header, getByLabelText } = mount();
    act(() => getByLabelText("search").focus());
    expect(header.hasAttribute("data-header-solid")).toBe(true);
    act(() => getByLabelText("search").blur());
    scrollTo(0);
    expect(header.hasAttribute("data-header-solid")).toBe(false);
    const toggle = header.querySelector("[data-toggle]") as HTMLElement;
    await act(async () => {
      toggle.setAttribute("aria-expanded", "true");
    });
    expect(header.hasAttribute("data-header-solid")).toBe(true);
    await act(async () => {
      toggle.setAttribute("aria-expanded", "false");
    });
    expect(header.hasAttribute("data-header-solid")).toBe(false);
    await act(async () => {
      document.body.setAttribute("data-scroll-locked", "1");
    });
    expect(header.hasAttribute("data-header-solid")).toBe(true);
  });

  it("removes every trace on unmount", () => {
    const { header, wrapper, unmount } = mount();
    scrollTo(100);
    unmount();
    expect(header.hasAttribute("data-header-live")).toBe(false);
    expect(header.hasAttribute("data-header-solid")).toBe(false);
    expect(wrapper.style.getPropertyValue("--hd-block")).toBe("");
  });
});

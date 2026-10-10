import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeaderScrollUp } from "../HeaderScrollUp";

function scrollTo(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
    vi.runAllTimers();
  });
}

function mount() {
  const view = render(
    <header>
      <HeaderScrollUp />
      <input aria-label="search" />
    </header>,
  );
  const header = view.container.querySelector("header") as HTMLElement;
  Object.defineProperty(header, "offsetHeight", {
    value: 80,
    configurable: true,
  });
  return { ...view, header };
}

describe("HeaderScrollUp (V7c-1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback) =>
        setTimeout(() => cb(0), 0) as unknown as number,
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.removeAttribute("data-scroll-locked");
  });

  it("hides on a downward scroll past the header and returns on the first upward one", () => {
    const { header } = mount();
    expect(header.hasAttribute("data-header-hidden")).toBe(false);
    scrollTo(60);
    expect(header.hasAttribute("data-header-hidden")).toBe(false); // still within the header's own height
    scrollTo(400);
    expect(header.hasAttribute("data-header-hidden")).toBe(true);
    scrollTo(380);
    expect(header.hasAttribute("data-header-hidden")).toBe(false);
  });

  it("stays visible while focus is inside the header", () => {
    const { header, getByLabelText } = mount();
    scrollTo(400);
    expect(header.hasAttribute("data-header-hidden")).toBe(true);
    act(() => getByLabelText("search").focus());
    expect(header.hasAttribute("data-header-hidden")).toBe(false); // focusin reveals
    scrollTo(700);
    expect(header.hasAttribute("data-header-hidden")).toBe(false); // and pins
  });

  it("stays visible while a menu is expanded or an open dialog locks the page", () => {
    const { header } = mount();
    const button = document.createElement("button");
    button.setAttribute("aria-expanded", "true");
    header.appendChild(button);
    scrollTo(400);
    expect(header.hasAttribute("data-header-hidden")).toBe(false);
    button.setAttribute("aria-expanded", "false");
    document.body.setAttribute("data-scroll-locked", "1");
    scrollTo(800);
    expect(header.hasAttribute("data-header-hidden")).toBe(false);
  });

  it("removes its state and listeners on unmount", () => {
    const { header, unmount } = mount();
    scrollTo(400);
    expect(header.hasAttribute("data-header-hidden")).toBe(true);
    unmount();
    expect(header.hasAttribute("data-header-hidden")).toBe(false);
  });
});

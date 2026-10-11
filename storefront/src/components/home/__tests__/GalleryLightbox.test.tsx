/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  GalleryLabels,
  GalleryViewerItem,
} from "@/components/home/GalleryClient";
import { GalleryLightbox } from "@/components/home/GalleryLightbox";

afterEach(() => {
  cleanup();
  document.documentElement.style.overflow = "";
});

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

const items = (n: number): GalleryViewerItem[] =>
  Array.from({ length: n }, (_, i) => ({
    webp: `/m${i}/800w.webp 800w`,
    jpg: `/m${i}/800w.jpg 800w`,
    src: `/m${i}/1600w.jpg`,
    width: 1600,
    height: 900,
    alt: `Alt ${i + 1}`,
    caption: i === 0 ? "First caption" : "",
  }));

function Harness({
  count = 3,
  start = 0,
  dir = "ltr",
  onClose = () => {},
}: {
  count?: number;
  start?: number;
  dir?: "ltr" | "rtl";
  onClose?: () => void;
}) {
  const [index, setIndex] = useState(start);
  return (
    <>
      <button type="button" data-testid="outside">
        outside
      </button>
      <GalleryLightbox
        items={items(count)}
        index={index}
        onIndex={setIndex}
        onClose={onClose}
        labels={labels}
        dir={dir}
      />
    </>
  );
}
const shown = () => screen.getByRole("img").getAttribute("alt");
const counter = () => screen.getByRole("status").textContent;

describe("GalleryLightbox (CUST-HV V8e)", () => {
  it("is a named modal dialog; focus moves to Close; the page behind is scroll-locked; the picture, caption and 'n of N' are shown", () => {
    render(<Harness />);
    const dialog = screen.getByRole("dialog", { name: "Picture viewer" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close viewer" }),
    );
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(shown()).toBe("Alt 1");
    expect(screen.getByText("First caption")).toBeTruthy();
    expect(counter()).toBe("1 of 3");
  });

  it("Esc, the Close button and a backdrop press close it; a press on the picture does not", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close viewer" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    const dialog = screen.getByRole("dialog");
    fireEvent.pointerDown(screen.getByRole("img"));
    fireEvent.click(screen.getByRole("img"));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("→ is next and ← is previous in LTR; the two swap in RTL (the keys follow the visual direction)", () => {
    const { unmount } = render(<Harness start={1} dir="ltr" />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(counter()).toBe("3 of 3");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(counter()).toBe("1 of 3");
    unmount();
    render(<Harness start={1} dir="rtl" />);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(counter()).toBe("3 of 3");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(counter()).toBe("1 of 3");
  });

  it("wraps around at both ends", () => {
    render(<Harness start={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Next picture" }));
    expect(counter()).toBe("1 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Previous picture" }));
    expect(counter()).toBe("3 of 3");
  });

  it("Tab and Shift+Tab cycle inside the dialog and never reach the page behind", () => {
    render(<Harness />);
    const close = screen.getByRole("button", { name: "Close viewer" });
    const previous = screen.getByRole("button", { name: "Previous picture" });
    const next = screen.getByRole("button", { name: "Next picture" });
    expect(document.activeElement).toBe(close);
    next.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(next);
    // focus that strays outside is pulled back in
    screen.getByTestId("outside").focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    previous.focus();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(
      true,
    );
  });

  it("the previous / next buttons sit on the logical edges (the dialog carries the document's direction)", () => {
    render(<Harness dir="rtl" />);
    expect(screen.getByRole("dialog").getAttribute("dir")).toBe("rtl");
    expect(
      document.querySelector('[data-gallery-viewer-nav="previous"]'),
    ).not.toBeNull();
  });

  it("a swipe toward the inline-start edge goes forward — leftward in LTR, rightward in RTL", () => {
    const swipe = (dx: number) => {
      const dialog = screen.getByRole("dialog");
      fireEvent.touchStart(dialog, {
        touches: [{ clientX: 200, clientY: 100 }],
      });
      fireEvent.touchEnd(dialog, {
        changedTouches: [{ clientX: 200 + dx, clientY: 100 }],
      });
    };
    const { unmount } = render(<Harness start={1} dir="ltr" />);
    swipe(-120);
    expect(counter()).toBe("3 of 3");
    swipe(120);
    expect(counter()).toBe("2 of 3");
    swipe(20); // too short
    expect(counter()).toBe("2 of 3");
    unmount();
    render(<Harness start={1} dir="rtl" />);
    swipe(120);
    expect(counter()).toBe("3 of 3");
    swipe(-120);
    expect(counter()).toBe("2 of 3");
  });

  it("a single picture has no previous / next and the arrow keys do nothing", () => {
    render(<Harness count={1} />);
    expect(screen.queryByRole("button", { name: "Next picture" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Previous picture" }),
    ).toBeNull();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(counter()).toBe("1 of 1");
  });

  it("restores the page's scroll when it unmounts", () => {
    document.documentElement.style.overflow = "scroll";
    const { unmount } = render(<Harness />);
    expect(document.documentElement.style.overflow).toBe("hidden");
    unmount();
    expect(document.documentElement.style.overflow).toBe("scroll");
  });
});

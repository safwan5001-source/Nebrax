/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaFramingEditor } from "../media/MediaFramingEditor";
import { customizerMessage } from "../messages";
import type { MediaRef } from "../presentation/media-ref";
import { MEDIA_ID, asset } from "./media-fixtures";

const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", key);

function open(value: MediaRef = { mediaId: MEDIA_ID, alt: { en: "Hero" } }) {
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(<MediaFramingEditor open onClose={onClose} value={value} asset={asset()} onApply={onApply} t={t} locale="en" />);
  return { onApply, onClose };
}
const applied = (fn: ReturnType<typeof vi.fn>): MediaRef => fn.mock.calls.at(-1)![0];

afterEach(cleanup);

describe("MediaFramingEditor (CUST-HV V4b)", () => {
  it("applying an untouched editor changes nothing (defaults are never stored)", async () => {
    const { onApply } = open();
    await userEvent.click(screen.getByRole("button", { name: t("mediaApply") }));
    expect(applied(onApply)).toEqual({ mediaId: MEDIA_ID, alt: { en: "Hero" } });
  });

  it("locks the crop to an aspect preset and keeps alt untouched", async () => {
    const { onApply } = open();
    await userEvent.click(screen.getByRole("button", { name: "16:9" }));
    await userEvent.click(screen.getByRole("button", { name: t("mediaApply") }));
    expect(applied(onApply)).toEqual({
      mediaId: MEDIA_ID,
      crop: { x: 0, y: 0.125, w: 1, h: 0.75, aspect: "16:9" },
      alt: { en: "Hero" },
    });
  });

  it("offers exactly the six approved presets plus Original", () => {
    open();
    const names = ["16:5", "3:1", "16:9", "4:3", "1:1", "4:5"];
    for (const name of names) expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.getByRole("button", { name: t("mediaAspectOriginal") }).getAttribute("aria-pressed")).toBe("true");
  });

  it("moves the crop with the arrow keys, clamped inside the image, and zooms with +/-", async () => {
    const { onApply } = open();
    await userEvent.click(screen.getByRole("button", { name: "1:1" }));
    const crop = document.querySelector("[data-media-crop]") as HTMLElement;
    crop.focus();
    for (let i = 0; i < 40; i += 1) fireEvent.keyDown(crop, { key: "ArrowRight" });
    fireEvent.keyDown(crop, { key: "+" });
    fireEvent.keyDown(crop, { key: "+" });
    await userEvent.click(screen.getByRole("button", { name: t("mediaApply") }));
    const out = applied(onApply).crop!;
    expect(out.x).toBeCloseTo(0.25, 4); // 1 − 0.75 width: pinned to the right edge
    expect(out.zoom).toBe(1.5);
  });

  it("zoom bounds are 1–4× via the buttons", async () => {
    const { onApply } = open();
    const zoomOut = screen.getByRole("button", { name: t("mediaZoomOut") }) as HTMLButtonElement;
    expect(zoomOut.disabled).toBe(true);
    const zoomIn = screen.getByRole("button", { name: t("mediaZoomIn") }) as HTMLButtonElement;
    for (let i = 0; i < 20; i += 1) await userEvent.click(zoomIn);
    expect(zoomIn.disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: t("mediaApply") }));
    expect(applied(onApply).crop).toMatchObject({ aspect: "free-locked", zoom: 4 });
  });

  it("focal: 3×3 snap and click on the result; fit; rotate", async () => {
    const { onApply } = open();
    await userEvent.click(screen.getByRole("button", { name: "top left" }));
    await userEvent.click(screen.getByRole("button", { name: t("mediaFitContain") }));
    await userEvent.click(screen.getByRole("button", { name: t("mediaRotate") }));
    await userEvent.click(screen.getByRole("button", { name: t("mediaRotate") }));
    await userEvent.click(screen.getByRole("button", { name: t("mediaApply") }));
    expect(applied(onApply)).toEqual({
      mediaId: MEDIA_ID,
      fit: "contain",
      focal: { x: 0, y: 0 },
      rotate: 180,
      alt: { en: "Hero" },
    });
  });

  it("a background picture (coverOnly) offers no Contain choice and never stores a fit", async () => {
    const onApply = vi.fn();
    render(
      <MediaFramingEditor
        open
        onClose={vi.fn()}
        value={{ mediaId: MEDIA_ID, decorative: true }}
        asset={asset()}
        onApply={onApply}
        t={t}
        locale="en"
        coverOnly
      />,
    );
    expect(screen.queryByRole("button", { name: t("mediaFitContain") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("mediaFitCover") })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "16:9" }));
    await userEvent.click(screen.getByRole("button", { name: t("mediaApply") }));
    expect(applied(onApply).fit).toBeUndefined();
  });

  it("the generic editor still offers Contain", () => {
    open();
    expect(screen.getByRole("button", { name: t("mediaFitContain") })).toBeTruthy();
  });

  it("rotation recomputes a locked crop in the rotated frame", async () => {
    const { onApply } = open();
    await userEvent.click(screen.getByRole("button", { name: "16:9" }));
    await userEvent.click(screen.getByRole("button", { name: t("mediaRotate") }));
    await userEvent.click(screen.getByRole("button", { name: t("mediaApply") }));
    const out = applied(onApply);
    expect(out.rotate).toBe(90);
    // a 3000×4000 frame: full width, height = 3000/(16/9)/4000
    expect(out.crop).toMatchObject({ aspect: "16:9", w: 1, x: 0 });
    expect(out.crop!.h).toBeCloseTo(0.4219, 3);
  });

  it("Reset restores the original framing in one action and is always available", async () => {
    const { onApply } = open({ mediaId: MEDIA_ID, rotate: 270, fit: "contain", focal: { x: 10, y: 90 } });
    const reset = screen.getByRole("button", { name: t("mediaReset") }) as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    await userEvent.click(reset);
    await userEvent.click(screen.getByRole("button", { name: t("mediaApply") }));
    expect(applied(onApply)).toEqual({ mediaId: MEDIA_ID });
  });

  it("Cancel / Escape apply nothing", async () => {
    const { onApply, onClose } = open();
    await userEvent.click(screen.getByRole("button", { name: "1:1" }));
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("states the edit is per placement and exposes the dialog accessibly", () => {
    open();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByText(t("mediaEditorIntro"))).toBeTruthy();
  });

  it("never prints a URL or path", () => {
    open();
    expect(document.body.textContent).not.toMatch(/https?:|\/store\/v1/);
  });
});

describe("dialog direction (portalled out of the builder shell)", () => {
  it("carries the builder's locale direction, not the page's", () => {
    render(<MediaFramingEditor open onClose={() => {}} value={{ mediaId: MEDIA_ID }} asset={asset()} onApply={() => {}} t={t} locale="en" />);
    expect(screen.getByRole("dialog").getAttribute("dir")).toBe("ltr");
    cleanup();
    render(<MediaFramingEditor open onClose={() => {}} value={{ mediaId: MEDIA_ID }} asset={asset()} onApply={() => {}} t={(k) => customizerMessage("ar", k)} locale="ar" />);
    expect(screen.getByRole("dialog").getAttribute("dir")).toBe("rtl");
  });
});

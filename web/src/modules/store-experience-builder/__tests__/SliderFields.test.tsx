/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackgroundMediaBounds } from "../media/use-background-media-bounds";
import { customizerMessage } from "../messages";
import type { DesignContext } from "../presentation/section-design-resolve";
import type { SliderContent } from "../presentation/slider-content";
import { SliderFields } from "../SliderFields";

vi.mock("../media/use-media-ref-preview", () => ({
  useMediaRefPreview: (ref: { mediaId: string } | null) => (ref ? `https://signed.example/${ref.mediaId}.jpg` : null),
}));
// the picker and the per-usage field have their own suites; here they are the seam through which a picture arrives
vi.mock("../media/MediaPicker", () => ({
  MediaPicker: ({ open, onSelect }: { open: boolean; onSelect: (asset: { id: string }) => void }) =>
    open ? (
      <button type="button" data-testid="pick-asset" onClick={() => onSelect({ id: "2d0b8e4a-5f5c-4c75-9e9a-ab3c4d5e6f70" })}>
        pick
      </button>
    ) : null,
}));
vi.mock("../media/MediaRefField", () => ({
  MediaRefField: ({
    slot,
    value,
    onChange,
    coverOnly,
    decorativeOnly,
  }: {
    slot: string;
    value: { mediaId: string } | null;
    onChange: (next: unknown) => void;
    coverOnly?: boolean;
    decorativeOnly?: boolean;
  }) => (
    <div data-testid={`field-${slot}`} data-cover-only={String(!!coverOnly)} data-decorative-only={String(!!decorativeOnly)}>
      <span>{value?.mediaId ?? "none"}</span>
      <button type="button" onClick={() => onChange({ mediaId: "9999aaaa-3d3a-4a53-9c7e-8f1a2b3c4d5e" })}>
        replace-{slot}
      </button>
      <button type="button" onClick={() => onChange(null)}>
        remove-{slot}
      </button>
    </div>
  ),
}));

afterEach(cleanup);

const A = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const B = "1c9a7d3f-4e4b-4b64-8d8f-9a2b3c4d5e6f";
const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", key);
const ctx: DesignContext = {
  primaryColor: "#12372a",
  accentColor: null,
  dir: "ltr",
  mediaBounds: (ref) => (ref.mediaId === A ? { min: [10, 12, 14], max: [40, 50, 60] } : null),
};
const light = { lookup: ctx.mediaBounds!, stateOf: (ref: { mediaId: string }) => (ref.mediaId === A ? "ready" : "unavailable") } as BackgroundMediaBounds;

const slide = (id: string, mediaId = A, extra: Record<string, unknown> = {}) => ({ id, media: { mediaId, decorative: true }, ...extra });

function Harness({ initial, bounds = light, context = ctx, onContent }: { initial: SliderContent; bounds?: BackgroundMediaBounds; context?: DesignContext; onContent?: (c: SliderContent) => void }) {
  const [content, setContent] = useState(initial);
  const [active, setActive] = useState<string | null>(null);
  return (
    <SliderFields
      content={content}
      ctx={context}
      bounds={bounds}
      locale="en"
      t={t}
      activeSlideId={active}
      onActiveSlideChange={setActive}
      onChange={(next) => {
        setContent(next);
        onContent?.(next);
      }}
    />
  );
}
const rows = () => [...document.querySelectorAll("[data-slider-slide-row]")].map((row) => row.getAttribute("data-slider-slide-row"));
const selectedRow = () => document.querySelector("[data-slider-slide-row][data-selected]")?.getAttribute("data-slider-slide-row");

describe("SliderFields (CUST-HV V8c-2)", () => {
  it("starts empty: says two slides are needed, offers Add, shows no slide editor", () => {
    render(<Harness initial={{ slides: [] }} />);
    expect(screen.getByText(t("sliderMinHint"))).toBeTruthy();
    expect(document.querySelector("[data-slider-count]")?.textContent).toBe("0 of 8");
    expect(document.querySelector("[data-slider-slide-editor]")).toBeNull();
    expect((document.querySelector("[data-slider-add]") as HTMLButtonElement).disabled).toBe(false);
  });

  it("adding picks a picture, creates a slide with only that picture, and selects it", () => {
    const seen: SliderContent[] = [];
    render(<Harness initial={{ slides: [] }} onContent={(c) => seen.push(c)} />);
    fireEvent.click(document.querySelector("[data-slider-add]")!);
    fireEvent.click(screen.getByTestId("pick-asset"));
    expect(seen.at(-1)?.slides).toHaveLength(1);
    expect(seen.at(-1)?.slides[0].media.mediaId).toBe("2d0b8e4a-5f5c-4c75-9e9a-ab3c4d5e6f70");
    expect(rows()).toHaveLength(1);
    expect(selectedRow()).toBe(seen.at(-1)?.slides[0].id);
    expect(document.querySelector("[data-slider-slide-editor]")).not.toBeNull();
  });

  it("add is disabled at eight slides and says why; the minimum hint disappears at two", () => {
    const eight = { slides: Array.from({ length: 8 }, (_, i) => slide(`s${i}`)) };
    const { unmount } = render(<Harness initial={eight} />);
    expect((document.querySelector("[data-slider-add]") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/limit \(8 slides\)/)).toBeTruthy();
    expect(screen.queryByText(t("sliderMinHint"))).toBeNull();
    unmount();
    render(<Harness initial={{ slides: [slide("a"), slide("b")] }} />);
    expect(screen.queryByText(t("sliderMinHint"))).toBeNull();
  });

  it("reorders with real buttons (first can't go up, last can't go down), duplicates after the original and deletes", () => {
    render(<Harness initial={{ slides: [slide("a"), slide("b"), slide("c")] }} />);
    expect((screen.getByLabelText("Move slide 1 up") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Move slide 3 down") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Move slide 1 down"));
    expect(rows()).toEqual(["b", "a", "c"]);
    fireEvent.click(screen.getByLabelText("Duplicate slide 1"));
    expect(rows()).toHaveLength(4);
    expect(rows()[0]).toBe("b");
    const copy = rows()[1];
    expect(copy).not.toBe("a");
    expect(selectedRow()).toBe(copy);
    fireEvent.click(screen.getByLabelText("Delete slide 2"));
    expect(rows()).toHaveLength(3);
  });

  it("deleting the selected slide selects its neighbour; deleting the last leaves an empty list", () => {
    render(<Harness initial={{ slides: [slide("a"), slide("b")] }} />);
    fireEvent.click(screen.getByLabelText("Delete slide 1"));
    expect(rows()).toEqual(["b"]);
    expect(selectedRow()).toBe("b");
    fireEvent.click(screen.getByLabelText("Delete slide 1"));
    expect(rows()).toEqual([]);
    expect(document.querySelector("[data-slider-slide-editor]")).toBeNull();
  });

  it("selecting a row shows that slide's editor; the main picture keeps alt (cover-only), the phone picture is decorative-only", () => {
    render(<Harness initial={{ slides: [slide("a"), slide("b", B)] }} />);
    fireEvent.click(within(document.querySelector('[data-slider-slide-row="b"]') as HTMLElement).getAllByRole("button")[0]);
    expect(document.querySelector('[data-slider-slide-editor="b"]')).not.toBeNull();
    const main = screen.getByTestId("field-slider-slide");
    expect(main.getAttribute("data-cover-only")).toBe("true");
    expect(main.getAttribute("data-decorative-only")).toBe("false");
    expect(screen.getByTestId("field-slider-slide-phone").getAttribute("data-decorative-only")).toBe("true");
  });

  it("copy edits store text; a blank heading removes it; the button needs label and link to count", () => {
    const seen: SliderContent[] = [];
    render(<Harness initial={{ slides: [slide("a"), slide("b")] }} onContent={(c) => seen.push(c)} />);
    fireEvent.change(document.querySelector("[data-slider-heading]")!, { target: { value: "Summer" } });
    expect(seen.at(-1)?.slides[0].heading).toBe("Summer");
    fireEvent.change(document.querySelector("[data-slider-heading]")!, { target: { value: "" } });
    expect("heading" in (seen.at(-1)?.slides[0] ?? {})).toBe(false);
    fireEvent.change(screen.getByLabelText(t("sliderCtaLabel")), { target: { value: "Shop" } });
    expect(seen.at(-1)?.slides[0].cta).toEqual({ label: "Shop", href: "" });
    const href = screen.getByLabelText(t("sliderCtaHref"));
    fireEvent.focus(href);
    fireEvent.change(href, { target: { value: "/products" } });
    fireEvent.blur(href);
    expect(seen.at(-1)?.slides[0].cta).toEqual({ label: "Shop", href: "/products" });
  });

  it("a picture whose range can't be proven under the copy is flagged on the row and the panel, and 'darker' raises the wash", () => {
    const seen: SliderContent[] = [];
    // black-to-white picture: no single text colour reads over all of it without a wash
    const wide = { ...ctx, mediaBounds: () => ({ min: [0, 0, 0], max: [255, 255, 255] }) } as DesignContext;
    const bounds = { lookup: wide.mediaBounds!, stateOf: () => "ready" } as unknown as BackgroundMediaBounds;
    render(<Harness initial={{ slides: [slide("a", A, { heading: "Hello" }), slide("b")] }} bounds={bounds} context={wide} onContent={(c) => seen.push(c)} />);
    expect(document.querySelector('[data-slider-slide-row="a"]')?.getAttribute("data-status")).toBe("unprovable");
    expect(document.querySelector('[data-slider-slide-row="a"] [data-slider-flag]')).not.toBeNull();
    expect(document.querySelector('[data-picture-status="unprovable"]')?.getAttribute("role")).toBe("alert");
    fireEvent.click(document.querySelector("[data-slider-overlay-darker]")!);
    expect(seen.at(-1)?.slides[0].overlay).toEqual({ color: { role: "overlay" }, alpha: 40 });
  });

  it("an unproven picture under copy says so (no evidence) and names the row", () => {
    render(<Harness initial={{ slides: [slide("a", B, { heading: "Hello" }), slide("b")] }} />);
    expect(document.querySelector('[data-slider-slide-row="a"]')?.getAttribute("data-status")).toBe("noEvidence");
    expect(document.querySelector('[data-slider-slide-row="a"] [data-slider-flag]')).not.toBeNull();
    expect(document.querySelector('[data-picture-status="noEvidence"]')).not.toBeNull();
    // no copy ⇒ nothing to prove, no flag
    expect(document.querySelector('[data-slider-slide-row="b"]')?.getAttribute("data-status")).toBe("none");
  });

  it("a proven picture with copy reads ok", () => {
    render(<Harness initial={{ slides: [slide("a", A, { heading: "Hello" }), slide("b")] }} />);
    expect(document.querySelector('[data-picture-status="ok"]')).not.toBeNull();
  });

  it("behaviour: interval appears only with autoplay, duration only when the transition moves, stored values are non-default only", () => {
    const seen: SliderContent[] = [];
    render(<Harness initial={{ slides: [slide("a"), slide("b")] }} onContent={(c) => seen.push(c)} />);
    const behaviour = document.querySelector("[data-slider-behaviour]") as HTMLElement;
    expect(within(behaviour).queryByText(t("sliderInterval"))).toBeNull();
    fireEvent.click(within(behaviour).getByLabelText(t("sliderAutoplay")));
    expect(seen.at(-1)?.behaviour).toEqual({ autoplay: true });
    fireEvent.click(within(behaviour).getByText("10 s"));
    expect(seen.at(-1)?.behaviour).toEqual({ autoplay: true, interval: 10 });
    fireEvent.click(within(behaviour).getByText(t("sliderTransitionNone")));
    expect(within(behaviour).queryByText(t("sliderDuration"))).toBeNull();
    fireEvent.click(within(behaviour).getByLabelText(t("sliderAutoplay")));
    expect(seen.at(-1)?.behaviour).toEqual({ transition: "none" });
  });

  it("the overlay controls write a valid wash and remove it again", () => {
    const seen: SliderContent[] = [];
    render(<Harness initial={{ slides: [slide("a"), slide("b")] }} onContent={(c) => seen.push(c)} />);
    const select = document.querySelector("[data-slider-overlay-alpha]") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "40" } });
    expect(seen.at(-1)?.slides[0].overlay).toEqual({ color: { role: "overlay" }, alpha: 40 });
    fireEvent.change(select, { target: { value: "0" } });
    expect("overlay" in (seen.at(-1)?.slides[0] ?? {})).toBe(false);
  });
});

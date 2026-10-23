/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GalleryFields } from "../GalleryFields";
import { customizerMessage } from "../messages";
import type { GalleryContent } from "../presentation/gallery-content";

vi.mock("../media/use-media-ref-preview", () => ({
  useMediaRefPreview: (ref: { mediaId: string } | null) => (ref ? `https://signed.example/${ref.mediaId}.jpg` : null),
}));
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
      <button type="button" onClick={() => onChange({ mediaId: "9999aaaa-3d3a-4a53-9c7e-8f1a2b3c4d5e", fit: "contain" })}>
        replace
      </button>
      <button type="button" onClick={() => onChange(null)}>
        remove
      </button>
    </div>
  ),
}));

afterEach(cleanup);

const A = "0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e";
const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", key);
const image = (id: string, extra: Record<string, unknown> = {}) => ({ id, media: { mediaId: A }, ...extra });

function Harness({ initial, onContent }: { initial: GalleryContent; onContent?: (c: GalleryContent) => void }) {
  const [content, setContent] = useState(initial);
  const [active, setActive] = useState<string | null>(null);
  return (
    <GalleryFields
      content={content}
      locale="en"
      t={t}
      activeImageId={active}
      onActiveImageChange={setActive}
      onChange={(next) => {
        setContent(next);
        onContent?.(next);
      }}
    />
  );
}
const rows = () => [...document.querySelectorAll("[data-gallery-image-row]")].map((r) => r.getAttribute("data-gallery-image-row"));
const selectedRow = () => document.querySelector("[data-gallery-image-row][data-selected]")?.getAttribute("data-gallery-image-row");

describe("GalleryFields (CUST-HV V8f)", () => {
  it("starts empty: says two pictures are needed, offers Add, shows no picture editor", () => {
    render(<Harness initial={{ images: [] }} />);
    expect(screen.getByText(t("galleryMinHint"))).toBeTruthy();
    expect(document.querySelector("[data-gallery-count]")?.textContent).toBe("0 of 24");
    expect(document.querySelector("[data-gallery-image-editor]")).toBeNull();
    expect((document.querySelector("[data-gallery-add]") as HTMLButtonElement).disabled).toBe(false);
  });

  it("adding picks a picture, creates an image with only that picture, and selects it", () => {
    const seen: GalleryContent[] = [];
    render(<Harness initial={{ images: [] }} onContent={(c) => seen.push(c)} />);
    fireEvent.click(document.querySelector("[data-gallery-add]")!);
    fireEvent.click(screen.getByTestId("pick-asset"));
    expect(seen.at(-1)?.images).toHaveLength(1);
    expect(seen.at(-1)?.images[0].media.mediaId).toBe("2d0b8e4a-5f5c-4c75-9e9a-ab3c4d5e6f70");
    expect(selectedRow()).toBe(seen.at(-1)?.images[0].id);
    expect(document.querySelector("[data-gallery-image-editor]")).not.toBeNull();
  });

  it("add is disabled at twenty-four and says why; the minimum hint disappears at two", () => {
    const full = { images: Array.from({ length: 24 }, (_, i) => image(`i${i}`)) };
    const { unmount } = render(<Harness initial={full} />);
    expect((document.querySelector("[data-gallery-add]") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/limit \(24 pictures\)/)).toBeTruthy();
    expect(screen.queryByText(t("galleryMinHint"))).toBeNull();
    unmount();
    render(<Harness initial={{ images: [image("a"), image("b")] }} />);
    expect(screen.queryByText(t("galleryMinHint"))).toBeNull();
  });

  it("reorders with real buttons, duplicates after the original and deletes (a neighbour is selected)", () => {
    render(<Harness initial={{ images: [image("a"), image("b"), image("c")] }} />);
    expect((screen.getByLabelText("Move picture 1 up") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Move picture 3 down") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Move picture 1 down"));
    expect(rows()).toEqual(["b", "a", "c"]);
    fireEvent.click(screen.getByLabelText("Duplicate picture 1"));
    expect(rows()).toHaveLength(4);
    expect(selectedRow()).toBe(rows()[1]);
    fireEvent.click(screen.getByLabelText("Delete picture 2"));
    expect(rows()).toHaveLength(3);
    expect(selectedRow()).toBeTruthy();
  });

  it("the picture field keeps the whole reference (alt, decorative, fit): not cover-only, not decorative-only", () => {
    const seen: GalleryContent[] = [];
    render(<Harness initial={{ images: [image("a"), image("b")] }} onContent={(c) => seen.push(c)} />);
    const field = screen.getByTestId("field-gallery-image");
    expect(field.getAttribute("data-cover-only")).toBe("false");
    expect(field.getAttribute("data-decorative-only")).toBe("false");
    fireEvent.click(screen.getByText("replace"));
    expect(seen.at(-1)?.images[0].media).toEqual({ mediaId: "9999aaaa-3d3a-4a53-9c7e-8f1a2b3c4d5e", fit: "contain" });
    // removing the picture is not an edit of the image — the list's Delete is
    fireEvent.click(screen.getByText("remove"));
    expect(seen.at(-1)?.images).toHaveLength(2);
  });

  it("caption and link edit the selected image; a blank caption removes it", () => {
    const seen: GalleryContent[] = [];
    render(<Harness initial={{ images: [image("a"), image("b")] }} onContent={(c) => seen.push(c)} />);
    fireEvent.change(document.querySelector("[data-gallery-caption-input]")!, { target: { value: "Summer" } });
    expect(seen.at(-1)?.images[0].caption).toBe("Summer");
    fireEvent.change(document.querySelector("[data-gallery-caption-input]")!, { target: { value: "" } });
    expect("caption" in (seen.at(-1)?.images[0] ?? {})).toBe(false);
    const href = screen.getByLabelText(new RegExp(`^${t("galleryLink")}`));
    fireEvent.focus(href);
    fireEvent.change(href, { target: { value: "/products" } });
    fireEvent.blur(href);
    expect(seen.at(-1)?.images[0].link).toBe("/products");
  });

  it("selecting a row shows that picture's editor", () => {
    render(<Harness initial={{ images: [image("a"), image("b", { caption: "Second" })] }} />);
    fireEvent.click(document.querySelector('[data-gallery-image-row="b"] button')!);
    expect(document.querySelector('[data-gallery-image-editor="b"]')).not.toBeNull();
    expect((document.querySelector("[data-gallery-caption-input]") as HTMLInputElement).value).toBe("Second");
  });

  it("options store only non-defaults; the gallery's shape is pointed to the Design tab", () => {
    const seen: GalleryContent[] = [];
    render(<Harness initial={{ images: [image("a"), image("b")] }} onContent={(c) => seen.push(c)} />);
    const options = document.querySelector("[data-gallery-options]") as HTMLElement;
    expect(options.textContent).toContain(t("galleryLayoutHint"));
    fireEvent.click(screen.getByText("6"));
    expect(seen.at(-1)?.options).toEqual({ columns: 6 });
    fireEvent.click(screen.getByText("16:9"));
    fireEvent.click(screen.getByText(t("galleryGapLg")));
    fireEvent.click(screen.getByLabelText(t("galleryCaptions")));
    fireEvent.click(screen.getByLabelText(t("galleryLightbox")));
    expect(seen.at(-1)?.options).toEqual({ columns: 6, aspect: "16:9", gap: "lg", captions: true, lightbox: true });
    fireEvent.click(screen.getByText("3"));
    fireEvent.click(screen.getByText("1:1"));
    fireEvent.click(screen.getByText(t("galleryGapMd")));
    fireEvent.click(screen.getByLabelText(t("galleryCaptions")));
    fireEvent.click(screen.getByLabelText(t("galleryLightbox")));
    expect(seen.at(-1)?.options).toBeUndefined();
  });

  it("the motion-controls choice is off by default, explained, and stored only when switched on", () => {
    const seen: GalleryContent[] = [];
    render(<Harness initial={{ images: [image("a"), image("b")] }} onContent={(c) => seen.push(c)} />);
    const toggle = screen.getByLabelText(t("galleryShowMotionControls")) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    const options = document.querySelector("[data-gallery-options]") as HTMLElement;
    expect(options.querySelector("[data-gallery-motion-hint]")?.textContent).toBe(t("galleryShowMotionControlsHint"));
    fireEvent.click(toggle);
    expect(seen.at(-1)?.options).toEqual({ showMotionControls: true });
    fireEvent.click(toggle);
    expect(seen.at(-1)?.options).toBeUndefined();
  });

  it("AR and EN carry the choice and the WCAG explanation, and the publish-error wording names the gallery", () => {
    for (const key of ["galleryShowMotionControls", "galleryShowMotionControlsHint"] as const) {
      expect(customizerMessage("ar", key)).not.toBe(customizerMessage("en", key));
      expect(customizerMessage("ar", key).length).toBeGreaterThan(10);
    }
    expect(customizerMessage("ar", "galleryShowMotionControlsHint")).toContain("WCAG 2.2.2");
    expect(customizerMessage("en", "galleryShowMotionControlsHint")).toContain("WCAG 2.2.2");
    expect(customizerMessage("ar", "mediaIssue_animated_not_allowed_here")).toContain("معرض الصور");
    expect(customizerMessage("en", "mediaIssue_animated_not_allowed_here")).toContain("gallery");
  });
});

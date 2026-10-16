/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "@/modules/commerce-workspace/storefront-media";
import { mapStorefrontMediaAsset } from "@/modules/commerce-workspace/storefront-media";
import { MediaPicker, uploadRejectionMessage } from "../media/MediaPicker";
import { MediaRefField } from "../media/MediaRefField";
import { CUSTOMIZER_MESSAGES, customizerMessage } from "../messages";
import { MEDIA_ID, asset, page } from "./media-fixtures";

vi.mock("@/modules/commerce-workspace/storefront-media", async (original) => ({
  ...(await original<typeof import("@/modules/commerce-workspace/storefront-media")>()),
  listStorefrontMedia: vi.fn(),
  uploadStorefrontMedia: vi.fn(),
  fetchStorefrontMediaAsset: vi.fn(),
  usageStatus: vi.fn(),
}));

const list = vi.mocked(client.listStorefrontMedia);
const upload = vi.mocked(client.uploadStorefrontMedia);
const fetchAsset = vi.mocked(client.fetchStorefrontMediaAsset);
const tEn = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", key);
const tAr = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("ar", key);

const ANIMATED_URL = "https://signed.example/animated.gif";

function animated() {
  return asset({
    id: MEDIA_ID,
    name: "promo.gif",
    mime: "image/gif",
    width: 800,
    height: 400,
    kind: "animated",
    animation: { url: ANIMATED_URL, format: "gif", frames: 12, durationMs: 1200, loop: true },
  });
}

beforeEach(() => {
  list.mockReset();
  upload.mockReset();
  fetchAsset.mockReset();
});
afterEach(cleanup);

describe("storefront-media client mapping (animated)", () => {
  it("maps the additive animation fields and leaves static assets untouched", () => {
    const base = { id: MEDIA_ID, name: "a", mime: "image/gif", size: 1, width: 4, height: 4, variants_state: "ready" };
    const a = mapStorefrontMediaAsset({
      ...base,
      kind: "animated",
      animation: { url: ANIMATED_URL, format: "webp", frames: 3, duration_ms: 600, loop: true },
    });
    expect(a.kind).toBe("animated");
    expect(a.animation).toEqual({ url: ANIMATED_URL, format: "webp", frames: 3, durationMs: 600, loop: true });

    const s = mapStorefrontMediaAsset({ ...base, mime: "image/jpeg" });
    expect(s.kind).toBe("image");
    expect(s.animation).toBeNull();
    expect(mapStorefrontMediaAsset({ ...base, kind: "animated" }).animation).toBeNull(); // no payload → not animated
  });
});

describe("MediaPicker with animated assets", () => {
  it("accepts GIF in the file dialog and states the format and limit in both locales", async () => {
    list.mockResolvedValue(page([]));
    const { container } = render(<MediaPicker open onClose={vi.fn()} onSelect={vi.fn()} t={tEn} locale="en" />);
    await screen.findByText(tEn("mediaEmpty"));
    await userEvent.click(screen.getByRole("tab", { name: tEn("mediaTabUpload") }));
    const input = container.ownerDocument.querySelector("#media-picker-files") as HTMLInputElement;
    expect(input.accept).toContain("image/gif");
    expect(input.accept).toContain("image/webp");
    expect(CUSTOMIZER_MESSAGES.en.mediaUploadHint).toMatch(/GIF/);
    expect(CUSTOMIZER_MESSAGES.ar.mediaUploadHint).toMatch(/GIF/);
  });

  it("shows a badge and a summary, keeps the still frame by default, and plays only on request", async () => {
    list.mockResolvedValue(page([animated()]));
    render(<MediaPicker open onClose={vi.fn()} onSelect={vi.fn()} t={tEn} locale="en" />);
    await screen.findByText("promo.gif");

    expect(screen.getByText(/GIF · Animated/)).toBeTruthy();
    expect(screen.getByText(/12 frames · 1.2 s/)).toBeTruthy();
    const img = () => document.querySelector("[data-media-card] img") as HTMLImageElement;
    expect(img().src).toBe("https://signed.example/thumb.webp"); // no autoplay: the still frame

    const toggle = screen.getByRole("button", { name: tEn("mediaMotionPlay") });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(toggle);
    expect(img().src).toBe(ANIMATED_URL);
    expect(screen.getByRole("button", { name: tEn("mediaMotionStop") }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: tEn("mediaMotionStop") }));
    expect(img().src).toBe("https://signed.example/thumb.webp");
  });

  it("has no motion UI on static assets", async () => {
    list.mockResolvedValue(page([asset()]));
    render(<MediaPicker open onClose={vi.fn()} onSelect={vi.fn()} t={tEn} locale="en" />);
    await screen.findByText("storefront-hero.jpg");
    expect(document.querySelector("[data-media-motion-toggle]")).toBeNull();
    expect(document.querySelector("[data-media-motion-badge]")).toBeNull();
  });

  it("localizes stable animated rejection codes and keeps the server text for others", async () => {
    expect(uploadRejectionMessage("animated_too_long", "نص عربي", tEn)).toBe(tEn("mediaErr_animated_too_long"));
    expect(uploadRejectionMessage("animated_too_long", "نص عربي", tAr)).toBe(tAr("mediaErr_animated_too_long"));
    expect(uploadRejectionMessage("dimension_too_small", "الصورة صغيرة", tEn)).toBe("الصورة صغيرة");

    list.mockResolvedValue(page([]));
    upload.mockResolvedValue({ status: "rejected", name: "x.gif", code: "animated_too_many_frames", message: "ar text" });
    const { container } = render(<MediaPicker open onClose={vi.fn()} onSelect={vi.fn()} t={tEn} locale="en" />);
    await screen.findByText(tEn("mediaEmpty"));
    await userEvent.click(screen.getByRole("tab", { name: tEn("mediaTabUpload") }));
    const input = container.ownerDocument.querySelector("#media-picker-files") as HTMLInputElement;
    await userEvent.upload(input, new File([new Uint8Array([1])], "x.gif", { type: "image/gif" }));
    await waitFor(() => expect(screen.getByText(new RegExp(tEn("mediaErr_animated_too_many_frames")))).toBeTruthy());
  });
});

describe("MediaRefField with an animated asset", () => {
  it("explains the framing limit and offers no crop/rotate editor", async () => {
    fetchAsset.mockResolvedValue(animated());
    render(
      <MediaRefField
        slot="hero"
        label="Image"
        value={{ mediaId: MEDIA_ID, decorative: true }}
        onChange={vi.fn()}
        t={tEn}
        locale="en"
      />,
    );
    await screen.findByText("promo.gif");
    expect(document.querySelector("[data-media-motion-note]")).toBeTruthy();
    expect(screen.queryByRole("button", { name: tEn("mediaEditImage") })).toBeNull();
    expect(document.querySelector("[data-media-edit]")).toBeNull();
  });

  it("keeps the editor for static assets", async () => {
    fetchAsset.mockResolvedValue(asset());
    render(
      <MediaRefField slot="hero" label="Image" value={{ mediaId: MEDIA_ID, decorative: true }} onChange={vi.fn()} t={tEn} locale="en" />,
    );
    await screen.findByText("storefront-hero.jpg");
    expect(document.querySelector("[data-media-edit]")).toBeTruthy();
  });
});

describe("animated copy parity", () => {
  it("has every animated key in both locales", () => {
    const keys = Object.keys(CUSTOMIZER_MESSAGES.ar).filter((k) => /^media(Motion|Err_animated|Issue_animated)/.test(k));
    expect(keys.length).toBeGreaterThanOrEqual(11);
    for (const k of keys) {
      expect((CUSTOMIZER_MESSAGES.en as Record<string, string>)[k], k).toBeTruthy();
    }
  });
});

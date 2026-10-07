/**
 * @vitest-environment jsdom
 *
 * CUST-HV V6b-4a — the Canvas paints a hero/banner picture background exactly when the server's
 * proven bounds make it publishable (the same decision as the publish gate and the storefront), with
 * the same `data-sd-backdrop` structure; unproven ⇒ the section keeps its legacy surface.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "@/modules/commerce-workspace/storefront-media";
import {
  DEFAULT_PRESENTATION_CONFIG,
  type PresentationHomeSection,
} from "../presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";
import { MEDIA_ID, MEDIA_ID_2, asset, usage } from "./media-fixtures";

vi.mock("@/modules/commerce-workspace/storefront-media", async (original) => ({
  ...(await original<typeof import("@/modules/commerce-workspace/storefront-media")>()),
  fetchStorefrontMediaAsset: vi.fn(),
  usageStatus: vi.fn(),
}));

const fetchAsset = vi.mocked(client.fetchStorefrontMediaAsset);
const status = vi.mocked(client.usageStatus);

const DARK: { min: [number, number, number]; max: [number, number, number] } = {
  min: [0, 0, 0],
  max: [40, 50, 60],
};

beforeEach(() => {
  fetchAsset.mockReset();
  status.mockReset();
  fetchAsset.mockImplementation(async (id) =>
    asset({ id, previewUrl: id === MEDIA_ID ? "https://signed.example/default.webp" : "https://signed.example/phone.webp" }),
  );
});
afterEach(cleanup);

const hero = (background: unknown): PresentationHomeSection =>
  ({ id: "hero", type: "hero", visible: true, design: { background } }) as PresentationHomeSection;

const picture = {
  kind: "media",
  media: { mediaId: MEDIA_ID, decorative: true },
  overlay: { color: { hex: "#000000" }, alpha: 40 },
};

const mount = (sections: PresentationHomeSection[], viewport: "desktop" | "mobile" = "desktop") =>
  render(
    <StorefrontPreviewCanvas
      config={{
        ...DEFAULT_PRESENTATION_CONFIG,
        homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, sections },
      }}
      locale="en"
      viewport={viewport}
      liveStoreName="Daisy Shop"
      onSelectSection={() => {}}
    />,
  ).container;

describe("Canvas picture backgrounds (CUST-HV V6b-4a)", () => {
  it("paints the backdrop once the server's bounds prove it: tokens, overlay vars, decorative picture", async () => {
    status.mockResolvedValue(usage({ contrast: DARK }));
    const c = mount([hero(picture)]);
    await waitFor(() => expect(c.querySelector("[data-sd-backdrop]")).toBeTruthy());
    const frame = c.querySelector("[data-sd]") as HTMLElement;
    const tokens = frame.getAttribute("data-sd")?.split(" ") ?? [];
    expect(tokens).toEqual(expect.arrayContaining(["mbg", "ovl", "fg"]));
    expect(frame.style.getPropertyValue("--sec-ovl-a")).toBe("0.4");
    const backdrop = c.querySelector("[data-sd-backdrop]") as HTMLElement;
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
    await waitFor(() => expect(backdrop.querySelector("img")?.getAttribute("src")).toBe("https://signed.example/default.webp"));
    expect(backdrop.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(backdrop.querySelector("[data-sd-overlay]")).toBeTruthy();
    expect(backdrop.parentElement?.firstElementChild).toBe(backdrop); // first child of the section
  });

  it("without proven bounds nothing paints: the legacy gradient and no text colour for the picture", async () => {
    status.mockResolvedValue(usage({ contrast: null }));
    const c = mount([hero(picture)]);
    await waitFor(() => expect(status).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(c.querySelector("[data-sd-backdrop]")).toBeNull();
    expect((c.querySelector("[data-sd]")?.getAttribute("data-sd") ?? "")).not.toContain("mbg");
  });

  it("a range the text cannot clear is not painted even with bounds", async () => {
    status.mockResolvedValue(usage({ contrast: { min: [0, 0, 0], max: [255, 255, 255] } }));
    const c = mount([hero({ kind: "media", media: { mediaId: MEDIA_ID, decorative: true } })]);
    await waitFor(() => expect(status).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(c.querySelector("[data-sd-backdrop]")).toBeNull();
  });

  it("the simulated phone viewport shows the phone picture; desktop shows the default one", async () => {
    status.mockResolvedValue(usage({ contrast: DARK }));
    const withPhone = { ...picture, mobile: { mediaId: MEDIA_ID_2, decorative: true } };
    const phone = mount([hero(withPhone)], "mobile");
    await waitFor(() => expect(phone.querySelector("[data-sd-backdrop] img")?.getAttribute("src")).toBe("https://signed.example/phone.webp"));
    cleanup();
    const desktop = mount([hero(withPhone)], "desktop");
    await waitFor(() => expect(desktop.querySelector("[data-sd-backdrop] img")?.getAttribute("src")).toBe("https://signed.example/default.webp"));
  });

  it("each picture is framed by its own focal point: the phone viewport uses the phone picture's", async () => {
    status.mockResolvedValue(usage({ contrast: DARK }));
    const framed = {
      ...picture,
      media: { mediaId: MEDIA_ID, decorative: true, focal: { x: 80, y: 20 } },
      mobile: { mediaId: MEDIA_ID_2, decorative: true, focal: { x: 15, y: 85 } },
    };
    const phone = mount([hero(framed)], "mobile");
    await waitFor(() => expect(phone.querySelector("[data-sd-backdrop]")).toBeTruthy());
    expect((phone.querySelector("[data-sd-backdrop]") as HTMLElement).style.getPropertyValue("--sd-pos")).toBe("15% 85%");
    cleanup();
    const desktop = mount([hero(framed)], "desktop");
    await waitFor(() => expect(desktop.querySelector("[data-sd-backdrop]")).toBeTruthy());
    expect((desktop.querySelector("[data-sd-backdrop]") as HTMLElement).style.getPropertyValue("--sd-pos")).toBe("80% 20%");
  });

  it("a hero without a picture background never reads the media status (no network, no change)", async () => {
    const c = mount([{ id: "hero", type: "hero", visible: true }]);
    expect(c.querySelector("[data-sd-backdrop]")).toBeNull();
    expect(status).not.toHaveBeenCalled();
  });
});

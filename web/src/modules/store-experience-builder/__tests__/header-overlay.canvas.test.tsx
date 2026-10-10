/**
 * @vitest-environment jsdom
 *
 * CUST-HV V7c-2 — the Canvas decides overlay-on-hero with the same pure resolver as the published Home and paints the same
 * markers: the hero frame carries `data-ho`, the root carries `hmo`, the controller simulates the scroll threshold.
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "@/modules/commerce-workspace/storefront-media";
import { ControlPanels } from "../ControlPanels";
import {
  DEFAULT_PRESENTATION_CONFIG,
  type PresentationHomeSection,
  type StorefrontPresentationConfig,
} from "../presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";
import { asset, MEDIA_ID, usage } from "./media-fixtures";

vi.mock("@/modules/commerce-workspace/storefront-media", async (original) => ({
  ...(await original<typeof import("@/modules/commerce-workspace/storefront-media")>()),
  fetchStorefrontMediaAsset: vi.fn(),
  usageStatus: vi.fn(),
}));

const fetchAsset = vi.mocked(client.fetchStorefrontMediaAsset);
const status = vi.mocked(client.usageStatus);
const DARK: { min: [number, number, number]; max: [number, number, number] } = { min: [0, 0, 0], max: [40, 50, 60] };

beforeEach(() => {
  fetchAsset.mockReset();
  status.mockReset();
  fetchAsset.mockImplementation(async (id) => asset({ id, previewUrl: "https://signed.example/default.webp" }));
});
afterEach(cleanup);

const hero = (design: Record<string, unknown> | undefined, id = "hero"): PresentationHomeSection =>
  ({ id, type: "hero", visible: true, ...(design ? { design } : {}) }) as PresentationHomeSection;
const picture = { background: { kind: "media", media: { mediaId: MEDIA_ID, decorative: true }, overlay: { color: { hex: "#000000" }, alpha: 40 } } };

function config(
  sections: PresentationHomeSection[],
  header: Record<string, unknown> = { mode: "overlay-hero" },
): StorefrontPresentationConfig {
  return {
    ...DEFAULT_PRESENTATION_CONFIG,
    header: { ...DEFAULT_PRESENTATION_CONFIG.header, design: header as never },
    homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, sections },
  };
}
const mount = (cfg: StorefrontPresentationConfig, viewport: "desktop" | "mobile" = "desktop") =>
  render(<StorefrontPreviewCanvas config={cfg} locale="en" viewport={viewport} liveStoreName="Daisy Shop" onSelectSection={() => {}} />).container;

describe("Canvas overlay-on-hero (V7c-2)", () => {
  it("marks the hero and the root once the picture is proven", async () => {
    status.mockResolvedValue(usage({ contrast: DARK }));
    const c = mount(config([hero(picture)]));
    await waitFor(() => expect(c.querySelector("[data-sd-backdrop]")).toBeTruthy());
    const root = c.querySelector("[data-preview-canvas]") as HTMLElement;
    expect(root.getAttribute("data-hd")).toBe("hmo");
    await waitFor(() => expect(c.querySelector("[data-ho]")?.getAttribute("data-ho")).toBe("on l"));
    expect(c.querySelector("header")?.hasAttribute("data-header-live")).toBe(true);
  });

  it("stays solid (no marker) while the picture's legibility is unproven", async () => {
    status.mockResolvedValue(usage({ contrast: null as never }));
    const c = mount(config([hero(picture)]));
    await new Promise((r) => setTimeout(r, 30));
    expect(c.querySelector("[data-ho]")).toBeNull();
  });

  it("stays solid for a split hero, a non-first hero, or a header that did not opt in", async () => {
    status.mockResolvedValue(usage({ contrast: DARK }));
    for (const cfg of [
      config([hero({ ...picture, layout: "split" })]),
      config([{ id: "b", type: "banner", visible: true } as PresentationHomeSection, hero(picture, "h2")]),
      config([hero(picture)], { layout: "standard" }),
      config([hero(picture)], { mode: "solid" }),
    ]) {
      const c = mount(cfg);
      await new Promise((r) => setTimeout(r, 30));
      expect(c.querySelector("[data-ho]")).toBeNull();
      cleanup();
    }
  });

  it("the scroll simulator turns the header solid past the threshold and again transparent at the top", async () => {
    status.mockResolvedValue(usage({ contrast: DARK }));
    const { container } = render(
      <div data-pane="" style={{ overflowY: "auto", height: 300 }}>
        <StorefrontPreviewCanvas config={config([hero(picture)])} locale="en" viewport="desktop" liveStoreName="Daisy Shop" onSelectSection={() => {}} />
      </div>,
    );
    await waitFor(() => expect(container.querySelector("[data-ho]")).toBeTruthy());
    const pane = container.querySelector("[data-pane]") as HTMLElement;
    const header = container.querySelector("header") as HTMLElement;
    expect(header.hasAttribute("data-header-solid")).toBe(false);
    pane.scrollTop = 200;
    act(() => {
      pane.dispatchEvent(new Event("scroll"));
    });
    expect(header.hasAttribute("data-header-solid")).toBe(true);
    pane.scrollTop = 0;
    act(() => {
      pane.dispatchEvent(new Event("scroll"));
    });
    expect(header.hasAttribute("data-header-solid")).toBe(false);
  });

  it("sticky off keeps the header out of the live (sticky) state", async () => {
    status.mockResolvedValue(usage({ contrast: DARK }));
    const c = mount(config([hero(picture)], { mode: "overlay-hero", sticky: "off" }));
    await waitFor(() => expect(c.querySelector("[data-ho]")).toBeTruthy());
    expect(c.querySelector("header")?.hasAttribute("data-header-live")).toBe(false);
  });
});

describe("Header mode control (V7c-2)", () => {
  const panel = (cfg: StorefrontPresentationConfig, onChange = vi.fn()) => {
    render(<ControlPanels panel="header" config={cfg} locale="en" liveStoreName={null} onChange={onChange} />);
    return onChange;
  };

  it("offers Solid and the overlay, starting on Default; choosing writes a normalised mode", async () => {
    const user = userEvent.setup();
    const onChange = panel({
      ...DEFAULT_PRESENTATION_CONFIG,
      homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, sections: [hero(picture)] },
    });
    const select = document.querySelector("[data-header-design='mode']") as HTMLSelectElement;
    expect(select.value).toBe("");
    await user.selectOptions(select, "overlay-hero");
    const next = onChange.mock.calls.at(-1)?.[0] as StorefrontPresentationConfig;
    expect(next.header.design).toEqual({ mode: "overlay-hero" });
  });

  it("explains why an opted-in overlay is not active", () => {
    panel(config([hero(undefined)]));
    expect(screen.getByText(/needs a picture background/)).toBeTruthy();
    cleanup();
    panel(config([{ id: "b", type: "banner", visible: true } as PresentationHomeSection]));
    expect(screen.getByText(/not a hero/)).toBeTruthy();
    cleanup();
    panel(config([hero({ ...picture, layout: "split" })]));
    expect(screen.getByText(/Split layout does not support/)).toBeTruthy();
    cleanup();
    panel(config([hero(picture)]));
    expect(document.querySelector("[data-header-mode-inactive]")).toBeNull();
  });

  it("no note appears while the mode is not overlay", () => {
    panel(config([hero(picture)], { mode: "solid" }));
    expect(document.querySelector("[data-header-mode-note]")).toBeNull();
  });
});

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

// ───────────── AWJ-HEADER-SCRIM — the protection layer (editor control, explanation and Canvas parity) ─────────────
const WIDE: { min: [number, number, number]; max: [number, number, number] } = { min: [0, 0, 0], max: [255, 255, 255] };
const plainPicture = { background: { kind: "media", media: { mediaId: MEDIA_ID, decorative: true } } };
// An image-only hero (AWJ-HERO-DISPLAY): with no text over it only the picture's own evidence is judged, so a full-range picture still paints —
// exactly the hero the store that reported the defect published.
const imageOnly = (design: Record<string, unknown> = plainPicture): PresentationHomeSection =>
  ({ id: "hero", type: "hero", visible: true, content: { headline: "", showTitle: false, showSubheadline: false, showCtas: false }, design }) as PresentationHomeSection;

describe("Canvas — the protection layer (AWJ-HEADER-SCRIM)", () => {
  it("a full-range picture stays solid without the option (what a store with this picture showed) and is overlaid, with a proven layer, with it", async () => {
    status.mockResolvedValue(usage({ contrast: WIDE }));
    const solid = mount(config([imageOnly()]));
    await waitFor(() => expect(solid.querySelector("[data-sd-backdrop]")).toBeTruthy());
    await new Promise((r) => setTimeout(r, 30));
    expect(solid.querySelector("[data-ho]")).toBeNull();
    cleanup();

    const c = mount(config([imageOnly()], { mode: "overlay-hero", overlayScrim: "auto" }));
    await waitFor(() => expect(c.querySelector("[data-ho]")?.getAttribute("data-ho")).toBe("on d s5"));
    expect((c.querySelector("[data-preview-canvas]") as HTMLElement).getAttribute("data-hd")).toBe("hmo");
    expect(c.querySelector("header")?.hasAttribute("data-header-live")).toBe(true);
  });

  it("a forced tone gets its own proven layer (white text needs the stronger black layer)", async () => {
    status.mockResolvedValue(usage({ contrast: WIDE }));
    const c = mount(config([imageOnly()], { mode: "overlay-hero", overlayTone: "light", overlayScrim: "auto" }));
    await waitFor(() => expect(c.querySelector("[data-ho]")?.getAttribute("data-ho")).toBe("on l s6"));
  });

  it("is never added when the picture alone proves the text: the marker is exactly the V7c-2 one", async () => {
    status.mockResolvedValue(usage({ contrast: DARK }));
    const c = mount(config([imageOnly()], { mode: "overlay-hero", overlayScrim: "auto" }));
    await waitFor(() => expect(c.querySelector("[data-ho]")?.getAttribute("data-ho")).toBe("on l"));
  });

  it("the structural rules still win: a split hero or an unproven picture stays solid even with the option", async () => {
    status.mockResolvedValue(usage({ contrast: WIDE }));
    const split = mount(config([imageOnly({ ...plainPicture, layout: "split" })], { mode: "overlay-hero", overlayScrim: "auto" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(split.querySelector("[data-ho]")).toBeNull();
    cleanup();
    status.mockResolvedValue(usage({ contrast: null as never }));
    const unproven = mount(config([imageOnly()], { mode: "overlay-hero", overlayScrim: "auto" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(unproven.querySelector("[data-ho]")).toBeNull();
  });
});

describe("Header protection-layer control (AWJ-HEADER-SCRIM)", () => {
  const panel = (cfg: StorefrontPresentationConfig, onChange = vi.fn()) => {
    render(<ControlPanels panel="header" config={cfg} locale="en" liveStoreName={null} onChange={onChange} />);
    return onChange;
  };
  const scrim = () => document.querySelector("[data-header-design='overlay-scrim']") as HTMLSelectElement | null;
  const lastDesign = (onChange: ReturnType<typeof vi.fn>) => (onChange.mock.calls.at(-1)?.[0] as StorefrontPresentationConfig).header.design;

  it("is hidden until the header is transparent over the hero, then starts on Default (no layer)", () => {
    panel(config([imageOnly()], { layout: "standard" }));
    expect(scrim()).toBeNull();
    cleanup();
    panel(config([imageOnly()], { mode: "solid" }));
    expect(scrim()).toBeNull();
    cleanup();
    panel(config([imageOnly()]));
    expect(scrim()?.value).toBe("");
    expect(Array.from(scrim()?.options ?? []).map((o) => o.value)).toEqual(["", "auto"]);
  });

  it("choosing Automatic writes overlayScrim, keeps the rest, and Default removes the key again", async () => {
    const user = userEvent.setup();
    const onChange = panel(config([imageOnly()], { mode: "overlay-hero", overlayTone: "dark", sticky: "off" }));
    await user.selectOptions(scrim() as HTMLSelectElement, "auto");
    expect(lastDesign(onChange)).toEqual({ mode: "overlay-hero", overlayTone: "dark", overlayScrim: "auto", sticky: "off" });
    cleanup();
    const again = panel(config([imageOnly()], { mode: "overlay-hero", overlayScrim: "auto" }));
    expect(scrim()?.value).toBe("auto");
    await user.selectOptions(scrim() as HTMLSelectElement, "");
    expect(lastDesign(again)).toEqual({ mode: "overlay-hero" });
  });

  it("switching the header back to solid drops the inert scrim with the tone (normalised)", async () => {
    const user = userEvent.setup();
    const onChange = panel(config([imageOnly()], { mode: "overlay-hero", overlayScrim: "auto" }));
    await user.selectOptions(document.querySelector("[data-header-design='mode']") as HTMLSelectElement, "solid");
    expect(lastDesign(onChange)).toEqual({ mode: "solid" });
  });

  it("EXPLAINS the contrast reason the merchant hit — a full-range picture with no layer — instead of staying silent", async () => {
    status.mockResolvedValue(usage({ contrast: WIDE }));
    panel(config([imageOnly()]));
    await waitFor(() => expect(document.querySelector("[data-header-mode-inactive][data-reason='unprovable']")).toBeTruthy());
    expect(screen.getByText(/cannot be proven legible over the whole picture/)).toBeTruthy();
    expect(document.querySelector("[data-header-mode-inactive][data-reason='unprovable']")?.textContent).toMatch(/Protection layer behind the header/);
  });

  it("with Automatic it says the layer is active and how strong; a picture that needs none shows no note", async () => {
    status.mockResolvedValue(usage({ contrast: WIDE }));
    panel(config([imageOnly()], { mode: "overlay-hero", overlayScrim: "auto" }));
    await waitFor(() => expect(document.querySelector("[data-header-mode-scrim]")?.textContent).toMatch(/strength 50%/));
    expect(document.querySelector("[data-header-mode-inactive]")).toBeNull();
    cleanup();
    status.mockResolvedValue(usage({ contrast: DARK }));
    panel(config([imageOnly()], { mode: "overlay-hero", overlayScrim: "auto" }));
    await new Promise((r) => setTimeout(r, 30));
    expect(document.querySelector("[data-header-mode-scrim]")).toBeNull();
    expect(document.querySelector("[data-header-mode-inactive]")).toBeNull();
  });

  it("says nothing about contrast while the picture is still being measured (no claim without a measurement)", async () => {
    status.mockImplementation(() => new Promise(() => {}));
    panel(config([imageOnly()]));
    await new Promise((r) => setTimeout(r, 30));
    expect(document.querySelector("[data-header-mode-inactive]")).toBeNull();
  });
});


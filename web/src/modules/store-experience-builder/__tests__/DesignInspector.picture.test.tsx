/**
 * @vitest-environment jsdom
 *
 * CUST-HV V6b-4b — the "Picture" background of a hero/banner: choose it, pick the picture(s), set
 * the overlay, and read the SAME verdict the publish gate will give (proven bounds from the server).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "@/modules/commerce-workspace/storefront-media";
import { DesignInspector } from "../design/DesignInspector";
import { clearDesignClipboard } from "../design/design-clipboard";
import type { BackgroundMediaBounds, BoundsState } from "../media/use-background-media-bounds";
import { customizerMessage } from "../messages";
import type { SectionDesign } from "../presentation/section-design";
import type { DesignContext, MediaBounds } from "../presentation/section-design-resolve";
import { MEDIA_ID, MEDIA_ID_2, asset, usage } from "./media-fixtures";

vi.mock("@/modules/commerce-workspace/storefront-media", async (original) => ({
  ...(await original<typeof import("@/modules/commerce-workspace/storefront-media")>()),
  listStorefrontMedia: vi.fn(),
  fetchStorefrontMediaAsset: vi.fn(),
  ensureUsage: vi.fn(),
  usageStatus: vi.fn(),
}));
const list = vi.mocked(client.listStorefrontMedia);
const fetchAsset = vi.mocked(client.fetchStorefrontMediaAsset);
const status = vi.mocked(client.usageStatus);

const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", key);
const DARK: MediaBounds = { min: [0, 0, 0], max: [40, 50, 60] };
const WIDE: MediaBounds = { min: [0, 0, 0], max: [255, 255, 255] };

function makeBounds(state: BoundsState, bounds: MediaBounds | null): BackgroundMediaBounds {
  return { lookup: () => bounds, stateOf: () => state };
}

function Harness({
  type = "hero",
  initial,
  bounds,
}: {
  type?: string;
  initial?: SectionDesign;
  bounds: BackgroundMediaBounds;
}) {
  const [design, setDesign] = useState<SectionDesign | undefined>(initial);
  const ctx: DesignContext = { primaryColor: "#12372a", accentColor: null, dir: "ltr", mediaBounds: bounds.lookup };
  return (
    <>
      <DesignInspector type={type} design={design} ctx={ctx} t={t} onChange={setDesign} locale="en" bounds={bounds} />
      <output data-testid="design">{JSON.stringify(design ?? null)}</output>
    </>
  );
}
const out = () => JSON.parse(screen.getByTestId("design").textContent ?? "null");

const picture = (extra: Record<string, unknown> = {}): SectionDesign =>
  ({
    background: { kind: "media", media: { mediaId: MEDIA_ID, decorative: true }, ...extra },
  }) as SectionDesign;

beforeEach(() => {
  clearDesignClipboard();
  window.localStorage.clear();
  [list, fetchAsset, status].forEach((m) => m.mockReset());
  fetchAsset.mockResolvedValue(asset());
  status.mockResolvedValue(usage());
  list.mockResolvedValue({
    items: [asset({ id: MEDIA_ID_2, name: "second.jpg" })],
    meta: {
      nextCursor: null,
      hasMore: false,
      uploadsEnabled: true,
      maxFilesPerRequest: 5,
      maxBytes: 20_000_000,
      library: { assets: 1, maxAssets: 500, bytes: 0, maxBytes: 1_000_000_000 },
    },
  });
});
afterEach(cleanup);

describe("DesignInspector — picture background (CUST-HV V6b-4b)", () => {
  it("offers Picture to hero and banner only", () => {
    for (const type of ["hero", "banner"]) {
      render(<Harness type={type} bounds={makeBounds("ready", DARK)} />);
      expect(screen.getByRole("button", { name: "Picture" })).toBeTruthy();
      cleanup();
    }
    for (const type of ["benefits", "categories", "appPromo"]) {
      render(<Harness type={type} bounds={makeBounds("ready", DARK)} />);
      expect(screen.queryByRole("button", { name: "Picture" })).toBeNull();
      cleanup();
    }
  });

  it("choosing Picture shows the picker and writes nothing until a picture is picked; picking stores a decorative reference", async () => {
    render(<Harness bounds={makeBounds("ready", DARK)} />);
    fireEvent.click(screen.getByRole("button", { name: "Picture" }));
    expect(out()).toBeNull();
    const pick = document.querySelector('[data-media-pick="section-background"]') as HTMLElement;
    expect(pick).toBeTruthy();
    fireEvent.click(pick);
    fireEvent.click(await screen.findByRole("button", { name: /Use: second\.jpg/ }));
    await waitFor(() =>
      expect(out().background).toEqual({ kind: "media", media: { mediaId: MEDIA_ID_2, decorative: true } }),
    );
  });

  it("a background picture is decoration: no decorative toggle and no alt fields", () => {
    render(<Harness initial={picture()} bounds={makeBounds("ready", DARK)} />);
    expect(document.querySelector('[data-media-field="section-background"]')).toBeTruthy();
    expect(document.querySelector("[data-media-alt]")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /decorative/i })).toBeNull();
  });

  it("the phone picture is optional and stored beside the main one; removing it leaves the main one", async () => {
    render(<Harness initial={picture({ mobile: { mediaId: MEDIA_ID_2, decorative: true } })} bounds={makeBounds("ready", DARK)} />);
    await waitFor(() => expect(document.querySelector('[data-media-remove="section-background-phone"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-media-remove="section-background-phone"]') as HTMLElement);
    await waitFor(() => expect(out().background.mobile).toBeUndefined());
    expect(out().background.media.mediaId).toBe(MEDIA_ID);
  });

  it("removing the main picture drops the background but keeps Picture selected for the next pick", async () => {
    render(<Harness initial={picture()} bounds={makeBounds("ready", DARK)} />);
    fireEvent.click(await waitFor(() => document.querySelector('[data-media-remove="section-background"]') as HTMLElement));
    await waitFor(() => expect(out()).toBeNull());
    expect(document.querySelector('[data-media-pick="section-background"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Picture" }).className).toContain("bg-primary");
  });

  it("the overlay strength is chosen in steps of 5 up to 90 and 'No overlay' removes it; the colour defaults to the overlay role", () => {
    render(<Harness initial={picture()} bounds={makeBounds("ready", DARK)} />);
    const select = document.querySelector("[data-design-overlay-alpha]") as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["0", ...Array.from({ length: 18 }, (_, i) => String((i + 1) * 5))]);
    fireEvent.change(select, { target: { value: "40" } });
    expect(out().background.overlay).toEqual({ color: { role: "overlay" }, alpha: 40 });
    fireEvent.click(document.querySelector('[data-colour-field="overlay-color"] [data-colour-role="brand"]') as HTMLElement);
    expect(out().background.overlay).toEqual({ color: { role: "brand" }, alpha: 40 });
    fireEvent.change(select, { target: { value: "0" } });
    expect(out().background.overlay).toBeUndefined();
  });

  it("proven ⇒ a positive verdict; still measuring ⇒ 'checking'; no valid measurement ⇒ say so", () => {
    render(<Harness initial={picture()} bounds={makeBounds("ready", DARK)} />);
    expect(document.querySelector("[data-picture-status]")?.getAttribute("data-picture-status")).toBe("ok");
    cleanup();
    render(<Harness initial={picture()} bounds={makeBounds("loading", null)} />);
    expect(document.querySelector("[data-picture-status]")?.getAttribute("data-picture-status")).toBe("checking");
    cleanup();
    render(<Harness initial={picture()} bounds={makeBounds("unavailable", null)} />);
    expect(document.querySelector("[data-picture-status]")?.getAttribute("data-picture-status")).toBe("noEvidence");
    expect(screen.getByRole("alert").textContent).toContain("can't be measured yet");
  });

  it("a range the text cannot clear is unprovable, and 'Add a darker overlay' raises the overlay until it is", () => {
    // the bounds depend on the overlay only through the contrast engine; the harness keeps WIDE regardless,
    // so this exercises the suggestion's effect on the document (the verdict flips in the engine tests)
    render(<Harness initial={picture()} bounds={makeBounds("ready", WIDE)} />);
    expect(document.querySelector("[data-picture-status]")?.getAttribute("data-picture-status")).toBe("unprovable");
    fireEvent.click(document.querySelector("[data-design-overlay-darker]") as HTMLElement);
    expect(out().background.overlay).toEqual({ color: { role: "overlay" }, alpha: 40 });
    fireEvent.click(document.querySelector("[data-design-overlay-darker]") as HTMLElement);
    expect(out().background.overlay.alpha).toBe(60);
  });

  it("a strong enough overlay makes the same wide range provable (the verdict is the engine's, live)", () => {
    render(<Harness initial={picture({ overlay: { color: { hex: "#000000" }, alpha: 80 } })} bounds={makeBounds("ready", WIDE)} />);
    expect(document.querySelector("[data-picture-status]")?.getAttribute("data-picture-status")).toBe("ok");
  });

  it("switching to a solid or gradient background leaves Picture behind", () => {
    render(<Harness initial={picture()} bounds={makeBounds("ready", DARK)} />);
    fireEvent.click(screen.getByRole("button", { name: "Solid" }));
    expect(out().background.kind).toBe("solid");
    expect(document.querySelector("[data-design-picture]")).toBeNull();
  });
});


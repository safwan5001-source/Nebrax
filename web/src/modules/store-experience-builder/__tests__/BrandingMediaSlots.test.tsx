/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "@/modules/commerce-workspace/storefront-media";
import { ControlPanels } from "../ControlPanels";
import { resetMediaCapabilityCache } from "../media/use-media-capability";
import { customizerMessage } from "../messages";
import { DEFAULT_PRESENTATION_CONFIG, type StorefrontPresentationConfig } from "../presentation/config";
import { MEDIA_ID, asset, page, usage } from "./media-fixtures";

vi.mock("@/modules/commerce-workspace/storefront-media", async (original) => ({
  ...(await original<typeof import("@/modules/commerce-workspace/storefront-media")>()),
  listStorefrontMedia: vi.fn(),
  fetchStorefrontMediaAsset: vi.fn(),
  ensureUsage: vi.fn(),
  usageStatus: vi.fn(),
}));

const list = vi.mocked(client.listStorefrontMedia);
const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", key);

function renderBranding(branding: Partial<StorefrontPresentationConfig["branding"]> = {}) {
  const onChange = vi.fn();
  render(
    <ControlPanels
      panel="branding"
      config={{ ...DEFAULT_PRESENTATION_CONFIG, branding: { ...DEFAULT_PRESENTATION_CONFIG.branding, ...branding } }}
      locale="en"
      liveStoreName={null}
      timezone="Asia/Riyadh"
      onChange={onChange}
    />,
  );
  return onChange;
}
const lastBranding = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0].branding;

beforeEach(() => {
  resetMediaCapabilityCache();
  list.mockReset();
  vi.mocked(client.fetchStorefrontMediaAsset).mockResolvedValue(asset());
  vi.mocked(client.usageStatus).mockResolvedValue(usage());
  vi.mocked(client.ensureUsage).mockResolvedValue(usage());
});
afterEach(cleanup);

describe("Identity media slots (CUST-HV V4b)", () => {
  it("capability-gated: the legacy upload is exactly what it was, no media UI", async () => {
    list.mockResolvedValue(page([], { uploadsEnabled: false }));
    renderBranding({ logoDataUrl: "data:image/png;base64,AAAA" });
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.getAllByRole("button", { name: /Remove/ }).length).toBeGreaterThan(0);
    expect(document.querySelector("[data-media-pick]")).toBeNull();
    expect(screen.queryByText(t("mediaSwitchToLibrary"))).toBeNull();
  });

  it("a failing capability probe reads as gated (never breaks the panel)", async () => {
    list.mockRejectedValue(new Error("offline"));
    renderBranding();
    await waitFor(() => expect(list).toHaveBeenCalled());
    expect(screen.getByText(t("logo"))).toBeTruthy();
    expect(document.querySelector("[data-media-pick]")).toBeNull();
  });

  it("library on, nothing embedded: the slot is the library only", async () => {
    list.mockResolvedValue(page([asset()]));
    renderBranding();
    await waitFor(() => expect(document.querySelector('[data-media-pick="logo"]')).toBeTruthy());
    expect(document.querySelector('[data-media-pick="compactLogo"]')).toBeTruthy();
    expect(document.querySelector('[data-media-pick="favicon"]')).toBeTruthy();
    expect(screen.queryByText(t("uploadLogo"))).toBeNull();
  });

  it("library on, legacy embedded: legacy stays, an explicit switch is offered, and choosing a library image clears ONLY that slot's legacy value", async () => {
    list.mockResolvedValue(page([asset()]));
    const onChange = renderBranding({
      logoDataUrl: "data:image/png;base64,AAAA",
      faviconDataUrl: "data:image/png;base64,BBBB",
    });
    await waitFor(() => expect(document.querySelectorAll("[data-logo-slot]").length).toBe(2)); // logo + favicon
    expect(screen.getAllByText(t("mediaSwitchToLibrary"))).toHaveLength(2);
    expect(screen.getAllByText(new RegExp(t("mediaLegacyBadge"))).length).toBe(2);
    expect(document.querySelector('[data-media-pick="compactLogo"]')).toBeTruthy(); // nothing embedded → plain pick

    await userEvent.click(document.querySelector('[data-logo-slot="logo"] [data-media-pick="logo"]') as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(await within(dialog).findByRole("button", { name: /Use: storefront-hero\.jpg/ }));

    const branding = lastBranding(onChange);
    expect(branding.logoMedia).toEqual({ mediaId: MEDIA_ID });
    expect(branding.logoDataUrl).toBeNull();
    expect(branding.faviconDataUrl).toBe("data:image/png;base64,BBBB"); // untouched: no bulk rewrite
    expect(branding.faviconMedia).toBeUndefined();
  });

  it("a slot with a reference shows the media field, and removing it does NOT resurrect the legacy value", async () => {
    list.mockResolvedValue(page([asset()]));
    const onChange = renderBranding({ logoMedia: { mediaId: MEDIA_ID } });
    expect(await screen.findByText("storefront-hero.jpg")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: t("mediaRemove") }));
    const branding = lastBranding(onChange);
    expect("logoMedia" in branding).toBe(false);
    expect(branding.logoDataUrl).toBeNull();
  });

  it("editing alt on a slot keeps the reference otherwise intact", async () => {
    list.mockResolvedValue(page([asset()]));
    const onChange = renderBranding({ logoMedia: { mediaId: MEDIA_ID, rotate: 90 } });
    await screen.findByText("storefront-hero.jpg");
    await userEvent.type(document.querySelector('[data-media-alt="en"]') as HTMLInputElement, "A");
    expect(lastBranding(onChange).logoMedia).toEqual({ mediaId: MEDIA_ID, rotate: 90, alt: { en: "A" } });
  });
});

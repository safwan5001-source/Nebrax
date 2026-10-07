/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "@/modules/commerce-workspace/storefront-media";
import { MediaRefField } from "../media/MediaRefField";
import { customizerMessage } from "../messages";
import type { MediaRef } from "../presentation/media-ref";
import { MEDIA_ID, asset, page, usage } from "./media-fixtures";

vi.mock("@/modules/commerce-workspace/storefront-media", async (original) => ({
  ...(await original<typeof import("@/modules/commerce-workspace/storefront-media")>()),
  listStorefrontMedia: vi.fn(),
  fetchStorefrontMediaAsset: vi.fn(),
  ensureUsage: vi.fn(),
  usageStatus: vi.fn(),
}));

const list = vi.mocked(client.listStorefrontMedia);
const fetchAsset = vi.mocked(client.fetchStorefrontMediaAsset);
const ensure = vi.mocked(client.ensureUsage);
const status = vi.mocked(client.usageStatus);
const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", key);

function Harness({ initial, spy }: { initial: MediaRef | null; spy?: (v: MediaRef | null) => void }) {
  const [value, setValue] = useState<MediaRef | null>(initial);
  return (
    <MediaRefField
      slot="logo"
      label="Store logo"
      value={value}
      t={t}
      locale="en"
      onChange={(next) => {
        spy?.(next);
        setValue(next);
      }}
    />
  );
}

beforeEach(() => {
  [list, fetchAsset, ensure, status].forEach((m) => m.mockReset());
  fetchAsset.mockResolvedValue(asset());
  status.mockResolvedValue(usage());
  ensure.mockResolvedValue(usage());
});
afterEach(cleanup);

describe("MediaRefField (CUST-HV V4b)", () => {
  it("is a single call-to-action when empty and selects an asset into a bare reference", async () => {
    list.mockResolvedValue(page([asset()]));
    const spy = vi.fn();
    render(<Harness initial={null} spy={spy} />);
    await userEvent.click(screen.getByRole("button", { name: t("mediaPick") }));
    await userEvent.click(await screen.findByRole("button", { name: /Use: storefront-hero\.jpg/ }));
    expect(spy).toHaveBeenCalledWith({ mediaId: MEDIA_ID });
    expect(await screen.findByText("storefront-hero.jpg")).toBeTruthy();
  });

  it("shows the selected card with dimensions and usage count", async () => {
    fetchAsset.mockResolvedValue(asset({ usageCount: 3 }));
    render(<Harness initial={{ mediaId: MEDIA_ID }} />);
    expect(await screen.findByText("storefront-hero.jpg")).toBeTruthy();
    expect(screen.getByText(/4000×3000/)).toBeTruthy();
    expect(screen.getByText(/Used in 3 places/)).toBeTruthy();
  });

  it("resolves the alt fallback per locale and never crosses languages (AMEND-14)", async () => {
    fetchAsset.mockResolvedValue(asset({ altAr: "صورة المتجر", altEn: null }));
    render(<Harness initial={{ mediaId: MEDIA_ID }} />);
    await screen.findByText("storefront-hero.jpg");
    const ar = await waitFor(() => {
      const el = document.querySelector('[data-alt-coverage="library"]');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(ar.textContent).toContain("صورة المتجر");
    const en = document.getElementById(
      (document.querySelector('[data-media-alt="en"]') as HTMLElement).id + "-cov",
    )!;
    expect(en.getAttribute("data-alt-coverage")).toBe("missing");
    expect(en.textContent).toBe(t("mediaAltMissing"));
    expect(en.textContent).not.toContain("صورة المتجر");
  });

  it("an override replaces the fallback for its own locale only, and clearing it restores the fallback", async () => {
    fetchAsset.mockResolvedValue(asset({ altAr: "الافتراضي", altEn: "Default" }));
    const spy = vi.fn();
    render(<Harness initial={{ mediaId: MEDIA_ID }} spy={spy} />);
    await screen.findByText("storefront-hero.jpg");
    const enInput = document.querySelector('[data-media-alt="en"]') as HTMLInputElement;
    await userEvent.type(enInput, "Hero");
    expect(spy).toHaveBeenLastCalledWith({ mediaId: MEDIA_ID, alt: { en: "Hero" } });
    await userEvent.clear(enInput);
    expect(spy).toHaveBeenLastCalledWith({ mediaId: MEDIA_ID });
  });

  it("decorative hides both alt fields, keeps them stored, and explains why", async () => {
    const spy = vi.fn();
    render(<Harness initial={{ mediaId: MEDIA_ID, alt: { ar: "x" } }} spy={spy} />);
    await screen.findByText("storefront-hero.jpg");
    await userEvent.click(screen.getByRole("checkbox"));
    expect(spy).toHaveBeenLastCalledWith({ mediaId: MEDIA_ID, alt: { ar: "x" }, decorative: true });
    expect(document.querySelector("[data-media-alt]")).toBeNull();
    expect(screen.getByText(t("mediaDecorativeHint"))).toBeTruthy();
  });

  it("shows a 'removed' placeholder with guidance when the asset no longer exists", async () => {
    fetchAsset.mockResolvedValue(null);
    render(<Harness initial={{ mediaId: MEDIA_ID }} />);
    expect(await screen.findByText(t("mediaRemovedPlaceholder") + ".")).toBeTruthy();
    expect(screen.getByText(t("mediaStale"), { exact: false })).toBeTruthy();
    expect((screen.getByRole("button", { name: t("mediaEditImage") }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Remove clears the reference", async () => {
    const spy = vi.fn();
    render(<Harness initial={{ mediaId: MEDIA_ID }} spy={spy} />);
    await screen.findByText("storefront-hero.jpg");
    await userEvent.click(screen.getByRole("button", { name: t("mediaRemove") }));
    expect(spy).toHaveBeenCalledWith(null);
    expect(screen.getByRole("button", { name: t("mediaPick") })).toBeTruthy();
  });

  describe("per-usage readiness", () => {
    const framed: MediaRef = { mediaId: MEDIA_ID, rotate: 90 };

    it("on mount only READS — never generates — and shows ready", async () => {
      render(<Harness initial={framed} />);
      expect(await screen.findByText(t("mediaUsageReady"))).toBeTruthy();
      expect(status).toHaveBeenCalledTimes(1);
      expect(ensure).not.toHaveBeenCalled();
    });

    it("a bare reference has no derivative to wait for", async () => {
      render(<Harness initial={{ mediaId: MEDIA_ID }} />);
      await screen.findByText("storefront-hero.jpg");
      expect(status).not.toHaveBeenCalled();
      expect(document.querySelector("[data-media-readiness]")).toBeNull();
    });

    it("generates once when the read says the usage is absent (reaped framing)", async () => {
      status.mockResolvedValue(usage({ state: "absent", files: [] }));
      render(<Harness initial={framed} />);
      expect(await screen.findByText(t("mediaUsageReady"))).toBeTruthy();
      expect(ensure).toHaveBeenCalledTimes(1);
      expect(ensure).toHaveBeenCalledWith(MEDIA_ID, { rotate: 90 }, { retry: false });
    });

    it("failed shows a scoped error with a Retry that re-runs only this usage", async () => {
      status.mockResolvedValue(usage({ state: "failed", retryable: true, errorCode: "storage_unavailable", files: [] }));
      render(<Harness initial={framed} />);
      expect(await screen.findByText(t("mediaUsageFailed"))).toBeTruthy();
      expect(screen.queryByText(/storage_unavailable/)).toBeNull(); // never a raw code
      await userEvent.click(screen.getByRole("button", { name: t("mediaUsageRetry") }));
      await waitFor(() => expect(ensure).toHaveBeenCalledWith(MEDIA_ID, { rotate: 90 }, { retry: true }));
      expect(await screen.findByText(t("mediaUsageReady"))).toBeTruthy();
    });

    it("a network failure while generating is a failed, retryable usage — never stuck", async () => {
      status.mockResolvedValue(usage({ state: "absent", files: [] }));
      ensure.mockRejectedValueOnce(new Error("offline"));
      render(<Harness initial={framed} />);
      expect(await screen.findByText(t("mediaUsageFailed"))).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: t("mediaUsageRetry") }));
      expect(await screen.findByText(t("mediaUsageReady"))).toBeTruthy();
    });
  });
});

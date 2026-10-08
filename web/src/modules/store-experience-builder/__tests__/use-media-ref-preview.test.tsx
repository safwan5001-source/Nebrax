/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "@/modules/commerce-workspace/storefront-media";
import { useMediaRefPreview } from "../media/use-media-ref-preview";
import { notifyUsageGenerated, usageKey } from "../media/use-usage-readiness";
import { MEDIA_ID, asset, usage } from "./media-fixtures";

vi.mock("@/modules/commerce-workspace/storefront-media", async (original) => ({
  ...(await original<typeof import("@/modules/commerce-workspace/storefront-media")>()),
  fetchStorefrontMediaAsset: vi.fn(),
  usageStatus: vi.fn(),
}));
const fetchAsset = vi.mocked(client.fetchStorefrontMediaAsset);
const status = vi.mocked(client.usageStatus);

beforeEach(() => {
  fetchAsset.mockReset();
  status.mockReset();
});
afterEach(cleanup);

const framed = { mediaId: MEDIA_ID, decorative: true as const, rotate: 90 as const };

describe("useMediaRefPreview (CUST-HV V6b-4)", () => {
  it("a framing applied just now shows the original first, then the framed rendition once its generation completes", async () => {
    fetchAsset.mockResolvedValue(asset());
    // read during the field's debounce: not generated yet
    status.mockResolvedValueOnce(usage({ state: "absent", files: [] }));
    const { result } = renderHook(() => useMediaRefPreview(framed));
    const base = asset().previewUrl ?? asset().thumbnailUrl;
    await waitFor(() => expect(result.current).toBe(base));

    status.mockResolvedValueOnce(usage({ state: "ready" }));
    await act(async () => {
      notifyUsageGenerated(usageKey(framed));
    });
    await waitFor(() => expect(result.current).toBe("https://signed.example/f768.webp"));
  });

  it("a usage another tab is generating ('processing') is followed to its framed rendition", async () => {
    vi.useFakeTimers();
    fetchAsset.mockResolvedValue(asset());
    status
      .mockResolvedValueOnce(usage({ state: "processing", files: [] }))
      .mockResolvedValueOnce(usage({ state: "ready" }));
    const { result } = renderHook(() => useMediaRefPreview(framed));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe(asset().previewUrl ?? asset().thumbnailUrl);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(result.current).toBe("https://signed.example/f768.webp");
    expect(status).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("ignores a generation signal for another usage", async () => {
    fetchAsset.mockResolvedValue(asset());
    status.mockResolvedValue(usage({ state: "absent", files: [] }));
    const { result } = renderHook(() => useMediaRefPreview(framed));
    const base = asset().previewUrl ?? asset().thumbnailUrl;
    await waitFor(() => expect(result.current).toBe(base));
    const calls = status.mock.calls.length;
    await act(async () => {
      notifyUsageGenerated("[\"someone-else\",{}]");
    });
    expect(status.mock.calls.length).toBe(calls);
    expect(result.current).toBe(base);
  });
});

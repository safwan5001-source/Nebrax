/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "@/modules/commerce-workspace/storefront-media";
import {
  backgroundPictureRefs,
  useBackgroundMediaBounds,
} from "../media/use-background-media-bounds";
import { notifyUsageGenerated, usageKey } from "../media/use-usage-readiness";
import type { SectionDesign } from "../presentation/section-design";
import { MEDIA_ID, MEDIA_ID_2, usage } from "./media-fixtures";

vi.mock("@/modules/commerce-workspace/storefront-media", async (original) => ({
  ...(await original<typeof import("@/modules/commerce-workspace/storefront-media")>()),
  usageStatus: vi.fn(),
}));
const status = vi.mocked(client.usageStatus);

beforeEach(() => status.mockReset());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const section = (design: SectionDesign | undefined, visible = true) => ({ visible, design });
const media = (mediaId: string) => ({ mediaId, decorative: true as const });
const bg = (...ids: string[]): SectionDesign => ({
  background: {
    kind: "media",
    media: media(ids[0]),
    ...(ids[1] ? { mobile: media(ids[1]) } : {}),
  },
});

describe("backgroundPictureRefs", () => {
  it("collects the default and phone pictures of VISIBLE picture backgrounds only", () => {
    const refs = backgroundPictureRefs([
      section(bg(MEDIA_ID, MEDIA_ID_2)),
      section(bg(MEDIA_ID), false),
      section({ background: { kind: "solid", color: { hex: "#ffffff" } } }),
      section(undefined),
    ]);
    expect(refs.map((r) => r.mediaId)).toEqual([MEDIA_ID, MEDIA_ID_2]);
  });
});

describe("useBackgroundMediaBounds (CUST-HV V6b-4a)", () => {
  it("reads each picture's bounds once and exposes them; unknown refs are unproven", async () => {
    status.mockResolvedValue(usage({ contrast: { min: [1, 2, 3], max: [4, 5, 6] } }));
    const sections = [section(bg(MEDIA_ID, MEDIA_ID_2))];
    const { result } = renderHook(() => useBackgroundMediaBounds(sections));
    const ref = sections[0].design?.background;
    if (ref?.kind !== "media") throw new Error("fixture");
    expect(result.current.lookup(ref.media)).toBeNull();
    expect(result.current.stateOf(ref.media)).toBe("loading");
    await waitFor(() => expect(result.current.lookup(ref.media)).toEqual({ min: [1, 2, 3], max: [4, 5, 6] }));
    expect(result.current.stateOf(ref.media)).toBe("ready");
    expect(status).toHaveBeenCalledTimes(2);
    expect(result.current.lookup({ mediaId: "other" })).toBeNull();
  });

  it("no valid evidence on a settled usage is 'unavailable'; a network error too", async () => {
    status.mockResolvedValueOnce(usage({ state: "ready", contrast: null }));
    status.mockRejectedValueOnce(new Error("offline"));
    const sections = [section(bg(MEDIA_ID, MEDIA_ID_2))];
    const { result } = renderHook(() => useBackgroundMediaBounds(sections));
    const background = sections[0].design?.background;
    if (background?.kind !== "media" || !background.mobile) throw new Error("fixture");
    await waitFor(() => expect(result.current.stateOf(background.media)).toBe("unavailable"));
    await waitFor(() => expect(result.current.stateOf(background.mobile as never)).toBe("unavailable"));
    expect(result.current.lookup(background.media)).toBeNull();
  });

  it("a usage still processing is polled until its bounds arrive", async () => {
    vi.useFakeTimers();
    status
      .mockResolvedValueOnce(usage({ state: "processing", contrast: null }))
      .mockResolvedValueOnce(usage({ state: "ready", contrast: { min: [9, 9, 9], max: [20, 20, 20] } }));
    const sections = [section(bg(MEDIA_ID))];
    const { result } = renderHook(() => useBackgroundMediaBounds(sections));
    const background = sections[0].design?.background;
    if (background?.kind !== "media") throw new Error("fixture");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.stateOf(background.media)).toBe("loading");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(result.current.lookup(background.media)).toEqual({ min: [9, 9, 9], max: [20, 20, 20] });
    expect(status).toHaveBeenCalledTimes(2);
  });

  it("a framed usage that is still 'absent' (generation not started) keeps being watched until bounds arrive", async () => {
    vi.useFakeTimers();
    status
      .mockResolvedValueOnce(usage({ state: "absent", files: [], contrast: null }))
      .mockResolvedValueOnce(usage({ state: "processing", contrast: null }))
      .mockResolvedValueOnce(usage({ state: "ready", contrast: { min: [5, 5, 5], max: [30, 30, 30] } }));
    const framed: SectionDesign = {
      background: { kind: "media", media: { mediaId: MEDIA_ID, decorative: true, rotate: 90 } },
    };
    const sections = [section(framed)];
    const { result } = renderHook(() => useBackgroundMediaBounds(sections));
    const background = sections[0].design?.background;
    if (background?.kind !== "media") throw new Error("fixture");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.stateOf(background.media)).toBe("loading");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4200);
    });
    expect(result.current.lookup(background.media)).toEqual({ min: [5, 5, 5], max: [30, 30, 30] });
    expect(status).toHaveBeenCalledTimes(3);
  });

  it("a framed usage still 'processing' is not evidence even if it carries bounds", async () => {
    vi.useFakeTimers();
    status
      .mockResolvedValueOnce(usage({ state: "processing", contrast: { min: [0, 0, 0], max: [10, 10, 10] } }))
      .mockResolvedValueOnce(usage({ state: "ready", contrast: { min: [2, 2, 2], max: [12, 12, 12] } }));
    const framed: SectionDesign = {
      background: { kind: "media", media: { mediaId: MEDIA_ID, decorative: true, rotate: 90 } },
    };
    const sections = [section(framed)];
    const { result } = renderHook(() => useBackgroundMediaBounds(sections));
    const background = sections[0].design?.background;
    if (background?.kind !== "media") throw new Error("fixture");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.lookup(background.media)).toBeNull();
    expect(result.current.stateOf(background.media)).toBe("loading");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(result.current.lookup(background.media)).toEqual({ min: [2, 2, 2], max: [12, 12, 12] });
  });

  it("an unframed picture without evidence is final at once ('absent' is normal for it)", async () => {
    status.mockResolvedValue(usage({ state: "absent", files: [], contrast: null }));
    const sections = [section(bg(MEDIA_ID))];
    const { result } = renderHook(() => useBackgroundMediaBounds(sections));
    const background = sections[0].design?.background;
    if (background?.kind !== "media") throw new Error("fixture");
    await waitFor(() => expect(result.current.stateOf(background.media)).toBe("unavailable"));
    expect(status).toHaveBeenCalledTimes(1);
  });

  it("a usage generated (or retried) by this editor is re-read at once, replacing a stale 'unavailable'", async () => {
    status.mockResolvedValueOnce(usage({ state: "failed", contrast: null }));
    const framed: SectionDesign = {
      background: { kind: "media", media: { mediaId: MEDIA_ID, decorative: true, rotate: 90 } },
    };
    const sections = [section(framed)];
    const { result } = renderHook(() => useBackgroundMediaBounds(sections));
    const background = sections[0].design?.background;
    if (background?.kind !== "media") throw new Error("fixture");
    await waitFor(() => expect(result.current.stateOf(background.media)).toBe("unavailable"));

    status.mockResolvedValueOnce(usage({ state: "ready", contrast: { min: [1, 1, 1], max: [9, 9, 9] } }));
    await act(async () => {
      notifyUsageGenerated(usageKey(background.media));
    });
    await waitFor(() => expect(result.current.lookup(background.media)).toEqual({ min: [1, 1, 1], max: [9, 9, 9] }));
    expect(result.current.stateOf(background.media)).toBe("ready");
  });

  it("does nothing for a document without picture backgrounds", () => {
    renderHook(() => useBackgroundMediaBounds([section(undefined)]));
    expect(status).not.toHaveBeenCalled();
  });
});

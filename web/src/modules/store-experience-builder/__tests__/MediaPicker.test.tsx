/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import * as client from "@/modules/commerce-workspace/storefront-media";
import { MediaPicker } from "../media/MediaPicker";
import { customizerMessage } from "../messages";
import { MEDIA_ID_2, asset, page } from "./media-fixtures";

vi.mock("@/modules/commerce-workspace/storefront-media", async (original) => ({
  ...(await original<typeof import("@/modules/commerce-workspace/storefront-media")>()),
  listStorefrontMedia: vi.fn(),
  uploadStorefrontMedia: vi.fn(),
  retryStorefrontMedia: vi.fn(),
}));

const list = vi.mocked(client.listStorefrontMedia);
const upload = vi.mocked(client.uploadStorefrontMedia);
const retry = vi.mocked(client.retryStorefrontMedia);
const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", key);

function open(onSelect = vi.fn(), onClose = vi.fn()) {
  render(<MediaPicker open onClose={onClose} onSelect={onSelect} t={t} locale="en" />);
  return { onSelect, onClose };
}

beforeEach(() => {
  list.mockReset();
  upload.mockReset();
  retry.mockReset();
});
afterEach(cleanup);

describe("MediaPicker (CUST-HV V4b)", () => {
  it("shows loading, then the grid, and selects a ready asset", async () => {
    list.mockResolvedValue(page([asset({ usageCount: 2 })]));
    const { onSelect } = open();
    expect(screen.getByText(t("mediaLoading"))).toBeTruthy();
    const card = await screen.findByText("storefront-hero.jpg");
    expect(card).toBeTruthy();
    expect(screen.getByText(/Used in 2 places/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Use: storefront-hero\.jpg/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: asset().id }));
  });

  it("shows the empty state with guidance", async () => {
    list.mockResolvedValue(page([]));
    open();
    expect(await screen.findByText(t("mediaEmpty"))).toBeTruthy();
    expect(screen.getByText(t("mediaEmptyHint"))).toBeTruthy();
  });

  it("passes search and the unused filter to the server and says when nothing matches", async () => {
    list.mockResolvedValue(page([asset()]));
    open();
    await screen.findByText("storefront-hero.jpg");
    list.mockResolvedValue(page([]));
    await userEvent.type(screen.getByRole("searchbox"), "banner");
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ q: "banner" })));
    expect(await screen.findByText(t("mediaNoResults"))).toBeTruthy();
    await userEvent.click(screen.getByLabelText(t("mediaUnusedOnly")));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ unused: true })));
  });

  it("keeps a processing asset visible but not selectable", async () => {
    list.mockResolvedValue(page([asset({ variantsState: "pending", thumbnailUrl: null })]));
    open();
    await screen.findByText(t("mediaStateProcessing"));
    const use = screen.getByRole("button", { name: /Use: storefront-hero\.jpg/ });
    expect((use as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers Retry on a failed asset and updates it in place", async () => {
    list.mockResolvedValue(page([asset({ variantsState: "failed", thumbnailUrl: null })]));
    retry.mockResolvedValue(asset({ variantsState: "ready" }));
    open();
    await screen.findByText(t("mediaStateFailed"));
    const use = screen.getByRole("button", { name: /Use: storefront-hero\.jpg/ }) as HTMLButtonElement;
    expect(use.disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: t("mediaRetry") }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith(asset().id));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: /Use: storefront-hero\.jpg/ }) as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it("shows a retryable network error and a permission-denied state", async () => {
    list.mockRejectedValueOnce(new Error("offline"));
    open();
    expect(await screen.findByText(t("mediaNetworkError"))).toBeTruthy();
    list.mockResolvedValue(page([asset()]));
    await userEvent.click(screen.getByRole("button", { name: t("mediaRetry") }));
    expect(await screen.findByText("storefront-hero.jpg")).toBeTruthy();
    cleanup();

    list.mockReset();
    list.mockRejectedValue(new ApiError(403, "no", {}));
    open();
    expect(await screen.findByText(t("mediaForbidden"))).toBeTruthy();
  });

  it("is capability-gated when uploads are off: message shown, upload disabled", async () => {
    list.mockResolvedValue(page([], { uploadsEnabled: false }));
    open();
    await screen.findByText(t("mediaGated"));
    await userEvent.click(screen.getByRole("tab", { name: t("mediaTabUpload") }));
    expect((screen.getByLabelText(t("mediaUploadChoose")) as HTMLInputElement).disabled).toBe(true);
  });

  it("uploads files one request each with per-file results, then lets the merchant use a ready one", async () => {
    list.mockResolvedValue(page([]));
    upload
      .mockResolvedValueOnce({ status: "created", name: "a.jpg", asset: asset({ id: MEDIA_ID_2, name: "a.jpg" }) })
      .mockResolvedValueOnce({ status: "rejected", name: "b.gif", code: "unsupported_type", message: "نوع غير مدعوم" })
      .mockRejectedValueOnce(new Error("boom"));
    const { onSelect } = open();
    await screen.findByText(t("mediaEmpty"));
    await userEvent.click(screen.getByRole("tab", { name: t("mediaTabUpload") }));
    const input = screen.getByLabelText(t("mediaUploadChoose"));
    fireEvent.change(input, {
      target: {
        files: [
          new File(["x"], "a.jpg", { type: "image/jpeg" }),
          new File(["x"], "b.gif", { type: "image/gif" }),
          new File(["x"], "c.png", { type: "image/png" }),
        ],
      },
    });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
    const rows = within(await screen.findByRole("list")).getAllByRole("listitem");
    await waitFor(() => expect(within(rows[0]).getByText(t("mediaUploaded"))).toBeTruthy());
    expect(within(rows[1]).getByText(/File rejected/)).toBeTruthy();
    expect(within(rows[2]).getByText(t("mediaUploadFailed"))).toBeTruthy();
    await userEvent.click(within(rows[0]).getByRole("button", { name: t("mediaUse") }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: MEDIA_ID_2 }));
  });

  it("never renders a URL, path or storage key as text", async () => {
    list.mockResolvedValue(page([asset()]));
    const { baseElement } = render(<MediaPicker open onClose={() => {}} onSelect={() => {}} t={t} locale="en" />);
    await screen.findAllByText("storefront-hero.jpg");
    expect(baseElement.textContent).not.toMatch(/https?:|\/store\/v1|storage|r2\./i);
  });
});

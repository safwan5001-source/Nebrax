/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "@/modules/commerce-workspace/storefront-media";
import { MediaRefField } from "../media/MediaRefField";
import { customizerMessage } from "../messages";
import { MEDIA_ID, asset, usage } from "./media-fixtures";

// AWJ-VD-H1 / VD-3 — `framing={false}` makes the field pick-only. The Customizer's default must not move at all.
const framingEditor = vi.hoisted(() => vi.fn());
vi.mock("../media/MediaFramingEditor", () => ({
  MediaFramingEditor: (props: { open: boolean }) => {
    framingEditor(props.open);
    return props.open ? <div data-testid="framing-editor" /> : null;
  },
}));
vi.mock("@/modules/commerce-workspace/storefront-media", async (original) => ({
  ...(await original<typeof import("@/modules/commerce-workspace/storefront-media")>()),
  listStorefrontMedia: vi.fn(),
  fetchStorefrontMediaAsset: vi.fn(),
  ensureUsage: vi.fn(),
  usageStatus: vi.fn(),
}));

const t = (key: Parameters<typeof customizerMessage>[1]) => customizerMessage("en", key);

function field(framing?: boolean, extra: { altRequired?: boolean } = {}) {
  return render(
    <MediaRefField
      slot="facet"
      label="Image"
      value={{ mediaId: MEDIA_ID }}
      t={t}
      locale="en"
      onChange={() => undefined}
      {...(framing === undefined ? {} : { framing })}
      {...extra}
    />,
  );
}

beforeEach(() => {
  framingEditor.mockReset();
  vi.mocked(client.fetchStorefrontMediaAsset).mockResolvedValue(asset());
  vi.mocked(client.usageStatus).mockResolvedValue(usage());
  vi.mocked(client.ensureUsage).mockResolvedValue(usage());
});
afterEach(cleanup);

describe("MediaRefField framing prop (VD-3)", () => {
  it("framing={false} hides the edit action and never mounts the framing editor", async () => {
    field(false);
    await screen.findByText("storefront-hero.jpg");
    expect(screen.queryByRole("button", { name: t("mediaEditImage") })).toBeNull();
    expect(document.querySelector("[data-media-edit]")).toBeNull();
    expect(framingEditor).not.toHaveBeenCalled();
    // pick-only still offers replace and remove
    expect(screen.getByRole("button", { name: t("mediaReplace") })).toBeTruthy();
    expect(screen.getByRole("button", { name: t("mediaRemove") })).toBeTruthy();
  });

  it("framing={false} keeps the alt text and the decorative choice", async () => {
    field(false);
    await screen.findByText("storefront-hero.jpg");
    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(document.querySelector('[data-media-alt="ar"]')).toBeTruthy();
  });

  it("regression: by default the field still offers «Edit image» and mounts the framing editor", async () => {
    field();
    await screen.findByText("storefront-hero.jpg");
    const edit = screen.getByRole("button", { name: t("mediaEditImage") });
    expect(framingEditor).toHaveBeenCalled();
    await userEvent.click(edit);
    expect(screen.getByTestId("framing-editor")).toBeTruthy();
  });

  it("regression: framing={true} is the same as the default", async () => {
    field(true);
    await screen.findByText("storefront-hero.jpg");
    expect(screen.getByRole("button", { name: t("mediaEditImage") })).toBeTruthy();
    expect(framingEditor).toHaveBeenCalled();
  });

  it("altRequired={false} shows a missing alt as a neutral note; the default keeps the red «required» error", async () => {
    const { unmount } = field(false, { altRequired: false });
    await screen.findByText("storefront-hero.jpg");
    const optional = document.querySelector('[data-alt-coverage="missing"]') as HTMLElement;
    expect(optional.textContent).toBe(t("mediaAltMissing"));
    expect(optional.className).toContain("text-muted");
    expect(optional.className).not.toContain("text-negative");
    expect(document.querySelector('[data-media-alt="ar"]')?.getAttribute("aria-invalid")).toBeNull();
    unmount();

    field(false);
    await screen.findByText("storefront-hero.jpg");
    const required = document.querySelector('[data-alt-coverage="missing"]') as HTMLElement;
    expect(required.className).toContain("text-negative");
    expect(document.querySelector('[data-media-alt="ar"]')?.getAttribute("aria-invalid")).toBe("true");
  });
});

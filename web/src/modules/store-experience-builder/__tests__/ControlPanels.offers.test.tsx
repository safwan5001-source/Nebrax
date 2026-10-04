/**
 * @vitest-environment jsdom
 *
 * CUST-H4-7 — Offers real multi-select picker (`OffersPickerFields`).
 * `ControlPanels` stays purely presentational: the one workspace Offers read
 * is owned by `ExperienceBuilder` (see `ExperienceBuilder.offers.test.tsx`
 * for fetch/sharing/stale-protection coverage) and passed in as props.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPanels } from "../ControlPanels";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import type { StorefrontPresentationConfig } from "../presentation/config";
import { KNOWN_OFFER_REASONS, type WorkspaceOffer } from "@/modules/commerce-workspace/workspace-offers";
import { CUSTOMIZER_MESSAGES } from "../messages";
import { hiddenOffer, liveOffer } from "./offers-fixtures";

function withOffersSections(
  ...sections: Array<{ id: string; offerIds: string[] }>
): StorefrontPresentationConfig {
  return {
    ...DEFAULT_PRESENTATION_CONFIG,
    homepage: {
      ...DEFAULT_PRESENTATION_CONFIG.homepage,
      sections: sections.map((section) => ({
        id: section.id,
        type: "offers" as const,
        visible: true,
        content: section.offerIds.length ? { offerIds: section.offerIds } : undefined,
      })),
    },
  };
}

function renderPicker(options: {
  offerIds?: string[];
  offers?: WorkspaceOffer[];
  state?: "idle" | "loading" | "error" | "ready";
  locale?: "ar" | "en";
  onChange?: ReturnType<typeof vi.fn>;
  onRetry?: () => void;
  selected?: string;
  config?: StorefrontPresentationConfig;
}) {
  const onChange = options.onChange ?? vi.fn();
  render(
    <ControlPanels
      panel="homepage"
      config={options.config ?? withOffersSections({ id: "offers-1", offerIds: options.offerIds ?? [] })}
      locale={options.locale ?? "ar"}
      liveStoreName={null}
      onChange={onChange}
      selectedSection={options.selected ?? "offers-1"}
      offers={options.offers ?? []}
      offersState={options.state ?? "ready"}
      onRetryOffers={options.onRetry}
    />,
  );
  return { onChange };
}

function offerIdsOf(onChange: ReturnType<typeof vi.fn>, call = 0, sectionIndex = 0): string[] {
  const next = onChange.mock.calls[call][0] as StorefrontPresentationConfig;
  const content = next.homepage.sections[sectionIndex].content as { offerIds: string[] } | undefined;
  return content?.offerIds ?? [];
}

function option(id: string): HTMLElement {
  const el = document.querySelector(`[data-offers-option="${id}"]`);
  if (!el) throw new Error(`option ${id} missing`);
  return el as HTMLElement;
}

function selectedItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll("[data-offers-selected-item]"));
}

describe("Store Customizer — Offers real picker (CUST-H4-7)", () => {
  afterEach(() => cleanup());

  it("renders real configured offers (name, live status, both prices, discount badge) — no raw id input", () => {
    renderPicker({ offers: [liveOffer({ id: "o1" })] });
    const row = option("o1");
    expect(row.textContent).toContain("هاتف ذكي");
    expect(row.textContent).toContain("ظاهر الآن");
    const live = row.querySelector('[data-offer-status="live"]') as HTMLElement;
    // Offer price + base price are both present and labelled for assistive tech.
    expect(live.textContent).toContain("سعر العرض");
    expect(live.textContent).toContain("السعر الأساسي");
    expect(live.textContent).toContain("190");
    expect(live.textContent).toContain("250");
    // Badge text comes straight from the backend `discount_percent` (24).
    expect(live.textContent).toContain("خصم 24%");
    expect(screen.queryByLabelText(/معرّف العرض/)).toBeNull();
    expect(document.querySelector('input[type="text"], input[type="search"]')).toBeNull();
  });

  it("never prints a raw offer id anywhere in the visible picker", () => {
    renderPicker({
      offerIds: ["secret-offer-uuid-1"],
      offers: [liveOffer({ id: "secret-offer-uuid-1" }), hiddenOffer("expired", { id: "secret-offer-uuid-2" })],
    });
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("secret-offer-uuid-1");
    expect(text).not.toContain("secret-offer-uuid-2");
  });

  it("derives nothing: a live row shows exactly the backend percent, and a 0% genuine discount draws no '0%' badge", () => {
    renderPicker({
      offers: [
        liveOffer({ id: "o-37", discountPercent: 37 }),
        liveOffer({
          id: "o-zero",
          discountPercent: 0,
          referencePrice: { amountMinor: 25000, currency: "SAR" },
          offerPrice: { amountMinor: 24999, currency: "SAR" },
        }),
      ],
    });
    expect(option("o-37").textContent).toContain("خصم 37%");
    const zero = option("o-zero");
    expect(zero.textContent).not.toContain("%");
    // Both prices stay visible so the relationship is still understandable.
    expect(zero.textContent).toContain("249.99");
    expect(zero.textContent).toContain("250");
  });

  it("formats prices per locale (English UI: '24% off' and a Latin currency string)", () => {
    renderPicker({ locale: "en", offers: [liveOffer({ id: "o1" })] });
    const row = option("o1");
    expect(row.textContent).toContain("24% off");
    expect(row.textContent).toContain("Smart phone");
    expect(row.textContent).toContain("Live now");
    expect(row.textContent).toContain("Offer price");
  });

  it.each(KNOWN_OFFER_REASONS)("shows an honest hidden state with the reason for '%s' — text, not colour alone", (reason) => {
    renderPicker({ offers: [hiddenOffer(reason, { id: "h1" })] });
    const status = option("h1").querySelector('[data-offer-status="hidden"]') as HTMLElement;
    expect(status).not.toBeNull();
    expect(status.textContent).toContain("غير ظاهر");
    expect(status.textContent).toContain(
      CUSTOMIZER_MESSAGES.ar[`offersReason_${reason}` as keyof typeof CUSTOMIZER_MESSAGES.ar],
    );
    // A hidden row exposes no price and no discount.
    expect(status.textContent).not.toContain("%");
    expect(option("h1").querySelector('[data-offer-status="live"]')).toBeNull();
  });

  it("falls back to an honest generic reason for an unknown future backend reason", () => {
    renderPicker({ offers: [hiddenOffer("brand_new_reason", { id: "h1" })] });
    expect(option("h1").textContent).toContain(CUSTOMIZER_MESSAGES.ar.offersReason_unknown);
    expect(option("h1").textContent).not.toContain("brand_new_reason");
  });

  it("has an Arabic and English string for every reason", () => {
    for (const reason of KNOWN_OFFER_REASONS) {
      const key = `offersReason_${reason}` as keyof typeof CUSTOMIZER_MESSAGES.ar;
      expect(CUSTOMIZER_MESSAGES.ar[key]).toBeTruthy();
      expect(CUSTOMIZER_MESSAGES.en[key]).toBeTruthy();
    }
  });

  it("shows a loading state while the offers are being fetched (idle and loading)", () => {
    renderPicker({ state: "loading" });
    expect(document.querySelector("[data-offers-picker-loading]")).not.toBeNull();
    cleanup();
    renderPicker({ state: "idle" });
    expect(document.querySelector("[data-offers-picker-loading]")).not.toBeNull();
  });

  it("shows an honest empty state when no offers are configured — and no pointer to a screen that doesn't exist", () => {
    renderPicker({ offers: [], state: "ready" });
    const empty = document.querySelector("[data-offers-picker-empty]") as HTMLElement;
    expect(empty).not.toBeNull();
    expect(empty.textContent).toContain("لا عروض مهيّأة");
  });

  it("shows an error with a working retry, and a refresh action when ready", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderPicker({ state: "error", onRetry });
    const box = document.querySelector("[data-offers-picker-error]") as HTMLElement;
    expect(box).not.toBeNull();
    await user.click(within(box).getByRole("button", { name: "إعادة المحاولة" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    cleanup();
    const onRefresh = vi.fn();
    renderPicker({ offers: [liveOffer()], onRetry: onRefresh });
    await user.click(screen.getByRole("button", { name: "تحديث القائمة" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("selecting a candidate appends its id, preserving the existing selection and order", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({
      offerIds: ["o2"],
      offers: [liveOffer({ id: "o1" }), liveOffer({ id: "o2" }), liveOffer({ id: "o3" })],
    });
    await user.click(option("o3"));
    expect(offerIdsOf(onChange)).toEqual(["o2", "o3"]);
  });

  it("clicking an already-selected candidate deselects it — a duplicate is structurally impossible", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({
      offerIds: ["o1", "o2"],
      offers: [liveOffer({ id: "o1" }), liveOffer({ id: "o2" })],
    });
    await user.click(option("o1"));
    expect(offerIdsOf(onChange)).toEqual(["o2"]);
    expect(offerIdsOf(onChange)).not.toContain("o1");
  });

  it("allows pre-selecting a hidden (e.g. scheduled) offer — the id is kept in the draft", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ offers: [hiddenOffer("scheduled", { id: "h1" })] });
    await user.click(option("h1"));
    expect(offerIdsOf(onChange)).toEqual(["h1"]);
  });

  it("removing a selected row removes exactly that id and keeps the rest in order", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({
      offerIds: ["o1", "o2", "o3"],
      offers: [liveOffer({ id: "o1" }), liveOffer({ id: "o2" }), liveOffer({ id: "o3" })],
    });
    const items = selectedItems();
    expect(items).toHaveLength(3);
    await user.click(within(items[1]).getByRole("button", { name: /إزالة العرض من الاختيار/ }));
    expect(offerIdsOf(onChange)).toEqual(["o1", "o3"]);
  });

  it("removing the last selected offer clears the section content (empty omission)", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ offerIds: ["o1"], offers: [liveOffer({ id: "o1" })] });
    await user.click(within(selectedItems()[0]).getByRole("button", { name: /إزالة العرض من الاختيار/ }));
    const next = onChange.mock.calls[0][0] as StorefrontPresentationConfig;
    expect(next.homepage.sections[0].content).toBeUndefined();
  });

  it("reorders selected offers with labelled up/down buttons, disabled at the edges", async () => {
    const user = userEvent.setup();
    const offers = [liveOffer({ id: "o1" }), liveOffer({ id: "o2" }), liveOffer({ id: "o3" })];
    const { onChange } = renderPicker({ offerIds: ["o1", "o2", "o3"], offers });
    const items = selectedItems();
    // Names are unambiguous per row: the product name is part of the label.
    expect(within(items[1]).getByRole("button", { name: /نقل العرض لأعلى: هاتف ذكي/ })).not.toBeNull();
    expect((within(items[0]).getByRole("button", { name: /نقل العرض لأعلى/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(items[2]).getByRole("button", { name: /نقل العرض لأسفل/ }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(within(items[1]).getByRole("button", { name: /نقل العرض لأعلى/ }));
    expect(offerIdsOf(onChange, 0)).toEqual(["o2", "o1", "o3"]);
    await user.click(within(items[1]).getByRole("button", { name: /نقل العرض لأسفل/ }));
    expect(offerIdsOf(onChange, 1)).toEqual(["o1", "o3", "o2"]);
  });

  it("renders selected rows in the stored order, not the workspace list order", () => {
    renderPicker({
      offerIds: ["o3", "o1"],
      offers: [
        liveOffer({ id: "o1", product: { name: "الأول", nameEn: null, thumbnailUrl: null } }),
        liveOffer({ id: "o2", product: { name: "الثاني", nameEn: null, thumbnailUrl: null } }),
        liveOffer({ id: "o3", product: { name: "الثالث", nameEn: null, thumbnailUrl: null } }),
      ],
    });
    const names = selectedItems().map((item) => item.textContent ?? "");
    expect(names[0]).toContain("الثالث");
    expect(names[1]).toContain("الأول");
  });

  it("enforces the maximum of 8 — unselected candidates are disabled, selected ones stay removable", async () => {
    const user = userEvent.setup();
    const ids = Array.from({ length: 8 }, (_, i) => `s${i}`);
    const offers = [...ids.map((id) => liveOffer({ id })), liveOffer({ id: "extra" })];
    const { onChange } = renderPicker({ offerIds: ids, offers });
    const extra = option("extra") as HTMLButtonElement;
    expect(extra.disabled).toBe(true);
    expect(document.body.textContent).toContain("8/8");
    expect(document.body.textContent).toContain(CUSTOMIZER_MESSAGES.ar.offersMaxReachedHint);
    await user.click(extra);
    expect(onChange).not.toHaveBeenCalled();
    // An already-selected candidate is still toggleable at the cap.
    expect((option("s0") as HTMLButtonElement).disabled).toBe(false);
    await user.click(option("s0"));
    expect(offerIdsOf(onChange)).toEqual(ids.slice(1));
  });

  it("announces the selected count politely and exposes the candidates as a labelled group of toggle buttons (aria-pressed)", () => {
    renderPicker({ offerIds: ["o1"], offers: [liveOffer({ id: "o1" }), liveOffer({ id: "o2" })] });
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe("1/8");
    expect(screen.getByRole("group", { name: "العروض المهيّأة في المتجر" })).not.toBeNull();
    expect(option("o1").getAttribute("aria-pressed")).toBe("true");
    expect(option("o2").getAttribute("aria-pressed")).toBe("false");
    // Each toggle has a meaningful accessible name that carries the product name.
    expect(screen.getAllByRole("button", { name: /اختيار العرض لهذا القسم: هاتف ذكي/ }).length).toBe(2);
  });

  it("is keyboard operable: Enter on a focused option selects it", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ offers: [liveOffer({ id: "o1" })] });
    option("o1").focus();
    await user.keyboard("{Enter}");
    expect(offerIdsOf(onChange)).toEqual(["o1"]);
  });

  it("keeps a selected offer that turned hidden in the draft and shows its reason in the selected row", () => {
    renderPicker({
      offerIds: ["h1"],
      offers: [hiddenOffer("out_of_stock", { id: "h1" })],
    });
    const row = selectedItems()[0];
    expect(row.textContent).toContain("غير ظاهر");
    expect(row.textContent).toContain(CUSTOMIZER_MESSAGES.ar.offersReason_out_of_stock);
    // Still removable.
    expect(within(row).getByRole("button", { name: /إزالة العرض من الاختيار/ })).not.toBeNull();
  });

  it("shows a selected id that no longer exists as 'no longer available' — removable, no fabricated product, no id", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({
      offerIds: ["gone-uuid"],
      offers: [liveOffer({ id: "o1" })],
    });
    const row = selectedItems()[0];
    expect(row.querySelector("[data-offers-unavailable]")).not.toBeNull();
    expect(row.textContent).toContain("عرض لم يعد متاحاً");
    expect(row.textContent).not.toContain("gone-uuid");
    await user.click(within(row).getByRole("button", { name: /إزالة العرض من الاختيار/ }));
    expect(onChange.mock.calls[0][0].homepage.sections[0].content).toBeUndefined();
  });

  it("does not flag a selected id as unavailable while the offers are still loading", () => {
    renderPicker({ offerIds: ["o1"], offers: [], state: "loading" });
    expect(document.querySelector("[data-offers-unavailable]")).toBeNull();
  });

  it("a deleted product (product: null) is shown as unavailable, never with an invented name", () => {
    renderPicker({
      offerIds: ["h1"],
      offers: [hiddenOffer("product_unavailable", { id: "h1", product: null })],
    });
    const row = selectedItems()[0];
    expect(row.textContent).toContain("عرض لم يعد متاحاً");
    expect(row.textContent).toContain(CUSTOMIZER_MESSAGES.ar.offersReason_product_unavailable);
  });

  it("handles long product names without a horizontal overflow hazard (wrapping, clamped lines)", () => {
    const long = "منتج باسم طويل جداً ".repeat(20);
    renderPicker({ offers: [liveOffer({ id: "o1", product: { name: long, nameEn: null, thumbnailUrl: null } })] });
    const name = option("o1").querySelector(".line-clamp-2") as HTMLElement;
    expect(name).not.toBeNull();
    expect(name.className).toContain("break-words");
    expect(option("o1").className).toContain("min-w-0");
  });

  it("keeps multiple Offers sections independent: selecting in one never touches the other", async () => {
    const user = userEvent.setup();
    const config = withOffersSections(
      { id: "offers-1", offerIds: ["o1"] },
      { id: "offers-2", offerIds: ["o2", "o3"] },
    );
    const offers = [liveOffer({ id: "o1" }), liveOffer({ id: "o2" }), liveOffer({ id: "o3" })];
    const onChange = vi.fn();
    renderPicker({ config, offers, selected: "offers-2", onChange });
    // The picker reflects offers-2's own selection…
    expect(selectedItems()).toHaveLength(2);
    // …and an edit writes only offers-2's content.
    await user.click(option("o1"));
    const next = onChange.mock.calls[0][0] as StorefrontPresentationConfig;
    expect((next.homepage.sections[0].content as { offerIds: string[] }).offerIds).toEqual(["o1"]);
    expect((next.homepage.sections[1].content as { offerIds: string[] }).offerIds).toEqual(["o2", "o3", "o1"]);
  });

  it("writes only offerIds — never a product id, name, image, price, percent or live flag", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker({ offers: [liveOffer({ id: "o1" })] });
    await user.click(option("o1"));
    const next = onChange.mock.calls[0][0] as StorefrontPresentationConfig;
    expect(next.homepage.sections[0].content).toEqual({ offerIds: ["o1"] });
  });
});

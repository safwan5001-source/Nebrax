/**
 * @vitest-environment jsdom
 *
 * CUST-H4-7 — Canvas rendering of the real "offers" section. The one
 * workspace Offers read is owned by `ExperienceBuilder` (see
 * `ExperienceBuilder.offers.test.tsx`); this covers the presentational
 * contract: only server-evaluated LIVE offers become cards, in the stored
 * `offerIds` order, with the backend's own price/percent values and no fake
 * fallback of any kind.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import type { StorefrontPresentationConfig } from "../presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";
import type { WorkspaceOffer } from "@/modules/commerce-workspace/workspace-offers";
import { hiddenOffer, liveOffer } from "./offers-fixtures";

function withSections(
  sections: StorefrontPresentationConfig["homepage"]["sections"],
): StorefrontPresentationConfig {
  return {
    ...DEFAULT_PRESENTATION_CONFIG,
    homepage: { ...DEFAULT_PRESENTATION_CONFIG.homepage, sections },
  };
}

function offersConfig(offerIds: string[], id = "offers-1") {
  return withSections([
    { id, type: "offers", visible: true, content: offerIds.length ? { offerIds } : undefined },
  ]);
}

function section(id = "offers-1") {
  return document.querySelector(`section[aria-labelledby="preview-offers-${id}"]`) as HTMLElement | null;
}

function renderCanvas(options: {
  config: StorefrontPresentationConfig;
  offers?: WorkspaceOffer[];
  state?: "idle" | "loading" | "error" | "ready";
  locale?: "ar" | "en";
  viewport?: "desktop" | "tablet" | "mobile";
  onRetry?: () => void;
}) {
  return render(
    <StorefrontPreviewCanvas
      config={options.config}
      locale={options.locale ?? "ar"}
      viewport={options.viewport ?? "desktop"}
      onSelectSection={() => {}}
      offers={options.offers}
      offersState={options.state ?? "ready"}
      onRetryOffers={options.onRetry}
    />,
  );
}

function cardNames(id = "offers-1"): string[] {
  return Array.from(section(id)?.querySelectorAll("[data-home-offer-card] p:first-child") ?? []).map(
    (el) => el.textContent ?? "",
  );
}

describe("Canvas — Offers real Commerce data (CUST-H4-7)", () => {
  afterEach(() => cleanup());

  it("renders a live offer card with the backend name, image, offer price, reference price and discount badge", () => {
    renderCanvas({ config: offersConfig(["o1"]), offers: [liveOffer({ id: "o1" })] });
    const el = section() as HTMLElement;
    expect(el.textContent).toContain("هاتف ذكي");
    expect(el.querySelector("[data-home-offer-price]")?.textContent).toContain("190");
    expect(el.querySelector("[data-home-offer-reference]")?.textContent).toContain("250");
    expect(el.querySelector("[data-home-offer-badge]")?.textContent).toBe("خصم 24%");
    expect(el.querySelector("img")?.getAttribute("src")).toBe("https://cdn.example.test/o1.jpg");
    // The price relationship is explained for assistive tech, not colour/strike alone.
    expect(el.textContent).toContain("سعر العرض");
    expect(el.textContent).toContain("السعر الأساسي");
    // The section heading labels the landmark.
    expect(el.querySelector("h2")?.id).toBe("preview-offers-offers-1");
  });

  it("uses the backend percent verbatim — it never recomputes it from the two prices", () => {
    // Deliberately inconsistent numbers: a client that derived the percent
    // would print 24, the contract says print exactly what the backend sent.
    renderCanvas({
      config: offersConfig(["o1"]),
      offers: [liveOffer({ id: "o1", discountPercent: 61 })],
    });
    expect(section()?.querySelector("[data-home-offer-badge]")?.textContent).toBe("خصم 61%");
  });

  it("draws no badge for a 0% genuine discount but keeps both prices", () => {
    renderCanvas({
      config: offersConfig(["o1"]),
      offers: [
        liveOffer({
          id: "o1",
          discountPercent: 0,
          referencePrice: { amountMinor: 25000, currency: "SAR" },
          offerPrice: { amountMinor: 24999, currency: "SAR" },
        }),
      ],
    });
    expect(section()?.querySelector("[data-home-offer-badge]")).toBeNull();
    expect(section()?.textContent).not.toContain("%");
    expect(section()?.querySelector("[data-home-offer-price]")?.textContent).toContain("249.99");
    expect(section()?.querySelector("[data-home-offer-reference]")?.textContent).toContain("250");
  });

  it("formats in English with a Latin '% off' badge under the English UI", () => {
    renderCanvas({ config: offersConfig(["o1"]), offers: [liveOffer({ id: "o1" })], locale: "en" });
    expect(section()?.querySelector("[data-home-offer-badge]")?.textContent).toBe("24% off");
    expect(section()?.textContent).toContain("Smart phone");
    expect(section()?.textContent).toContain("Offer price");
  });

  it("restores the merchant-stored offerIds order, not the workspace list order", () => {
    const mk = (id: string, name: string) =>
      liveOffer({ id, product: { name, nameEn: null, thumbnailUrl: null } });
    renderCanvas({
      config: offersConfig(["o3", "o1", "o2"]),
      offers: [mk("o1", "الأول"), mk("o2", "الثاني"), mk("o3", "الثالث")],
    });
    expect(cardNames()).toEqual(["الثالث", "الأول", "الثاني"]);
  });

  it("only renders the selected offers (an unselected live offer never appears)", () => {
    renderCanvas({
      config: offersConfig(["o2"]),
      offers: [liveOffer({ id: "o1" }), liveOffer({ id: "o2", product: { name: "المختار", nameEn: null, thumbnailUrl: null } })],
    });
    expect(cardNames()).toEqual(["المختار"]);
  });

  it("omits a hidden selected offer — no card, no price, no reason on the Canvas", () => {
    renderCanvas({
      config: offersConfig(["h1", "o1"]),
      offers: [hiddenOffer("expired", { id: "h1" }), liveOffer({ id: "o1" })],
    });
    expect(cardNames()).toEqual(["هاتف ذكي"]);
    expect(section()?.textContent).not.toContain("منتج مخفي");
    expect(section()?.textContent).not.toContain("انتهت فترته");
  });

  it("omits a selected id that no longer exists in the workspace list, without a placeholder", () => {
    renderCanvas({ config: offersConfig(["gone", "o1"]), offers: [liveOffer({ id: "o1" })] });
    expect(section()?.querySelectorAll("[data-home-offer-card]")).toHaveLength(1);
    expect(section()?.textContent ?? "").not.toContain("gone");
  });

  it("never renders a live-flagged row whose product is missing (no fabricated name)", () => {
    renderCanvas({
      config: offersConfig(["o1"]),
      offers: [liveOffer({ id: "o1", product: null })],
    });
    expect(section()?.querySelectorAll("[data-home-offer-card]")).toHaveLength(0);
    expect(section()?.querySelector("[data-home-offers-none-live]")).not.toBeNull();
  });

  it("says honestly when none of the selected offers is live — never fake cards", () => {
    renderCanvas({
      config: offersConfig(["h1"]),
      offers: [hiddenOffer("not_discounted", { id: "h1" })],
    });
    expect(section()?.querySelector("[data-home-offers-none-live]")).not.toBeNull();
    expect(section()?.querySelectorAll("[data-home-offer-card]")).toHaveLength(0);
  });

  it("renders an honest empty state when no offers are selected (no fabricated demo offers)", () => {
    renderCanvas({ config: offersConfig([]), offers: [liveOffer({ id: "o1" })] });
    expect(document.querySelector("[data-home-offers-empty]")).not.toBeNull();
    expect(section()?.querySelectorAll("[data-home-offer-card]")).toHaveLength(0);
    expect(section()?.textContent ?? "").not.toMatch(/%|SAR|ر\.س/);
  });

  it("shows a loading skeleton while idle/loading, never stale or invented cards", () => {
    renderCanvas({ config: offersConfig(["o1"]), offers: [], state: "loading" });
    expect(section()?.querySelector(".animate-pulse")).not.toBeNull();
    expect(section()?.querySelectorAll("[data-home-offer-card]")).toHaveLength(0);
    cleanup();
    renderCanvas({ config: offersConfig(["o1"]), offers: [], state: "idle" });
    expect(section()?.querySelector(".animate-pulse")).not.toBeNull();
  });

  it("shows a retry affordance on error, never fake content", () => {
    const onRetry = vi.fn();
    renderCanvas({ config: offersConfig(["o1"]), offers: [], state: "error", onRetry });
    const box = document.querySelector("[data-home-offers-error]") as HTMLElement;
    expect(box).not.toBeNull();
    (box.querySelector("button") as HTMLButtonElement).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(section()?.querySelectorAll("[data-home-offer-card]")).toHaveLength(0);
  });

  it("keeps two Offers instances independent: each maps its own offerIds with its own heading id", () => {
    const config = withSections([
      { id: "offers-1", type: "offers", visible: true, content: { offerIds: ["o1"] } },
      { id: "offers-2", type: "offers", visible: true, content: { offerIds: ["o2", "o1"] } },
    ]);
    const mk = (id: string, name: string) =>
      liveOffer({ id, product: { name, nameEn: null, thumbnailUrl: null } });
    renderCanvas({ config, offers: [mk("o1", "الأول"), mk("o2", "الثاني")] });
    expect(cardNames("offers-1")).toEqual(["الأول"]);
    expect(cardNames("offers-2")).toEqual(["الثاني", "الأول"]);
    expect(section("offers-1")?.querySelector("h2")?.id).toBe("preview-offers-offers-1");
    expect(section("offers-2")?.querySelector("h2")?.id).toBe("preview-offers-offers-2");
  });

  it("is not rendered at all when the instance is hidden", () => {
    const config = withSections([
      { id: "offers-1", type: "offers", visible: false, content: { offerIds: ["o1"] } },
    ]);
    renderCanvas({ config, offers: [liveOffer({ id: "o1" })] });
    expect(section()).toBeNull();
  });

  it("no longer renders the gated placeholder for an offers section", () => {
    renderCanvas({ config: offersConfig(["o1"]), offers: [liveOffer({ id: "o1" })] });
    expect(document.body.textContent).not.toContain("غير مفعّل");
    expect(document.body.textContent).not.toContain("محرك العروض");
  });

  it.each(["desktop", "tablet", "mobile"] as const)("renders cards in the %s viewport without fixed-width overflow classes", (viewport) => {
    renderCanvas({ config: offersConfig(["o1"]), offers: [liveOffer({ id: "o1" })], viewport });
    const card = section()?.querySelector("[data-home-offer-card]") as HTMLElement;
    expect(card.className).toContain("min-w-0");
    expect(card.className).not.toMatch(/\bw-\[\d+px\]/);
  });
});

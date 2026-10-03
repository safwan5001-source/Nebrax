/**
 * @vitest-environment jsdom
 *
 * CUST-H4-5 — Featured Products real multi-select picker
 * (`FeaturedPickerFields`), replacing the raw product-id text input.
 * `ControlPanels` stays purely presentational: no fetch happens here, the
 * candidate list / selected-products resolution are owned by
 * `ExperienceBuilder` and passed in as props (see `ExperienceBuilder.featured.test.tsx`
 * for the fetch/batching/stale-protection coverage).
 */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlPanels } from "../ControlPanels";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import type { StorefrontPresentationConfig } from "../presentation/config";
import type { WorkspaceProductSummary } from "@/modules/commerce-workspace/workspace-products";

function withFeaturedSection(
  productIds: string[],
): StorefrontPresentationConfig {
  return {
    ...DEFAULT_PRESENTATION_CONFIG,
    homepage: {
      ...DEFAULT_PRESENTATION_CONFIG.homepage,
      sections: [
        { id: "featured-1", type: "featured", visible: true, content: { productIds } },
      ],
    },
  };
}

function product(overrides: Partial<WorkspaceProductSummary> = {}): WorkspaceProductSummary {
  return {
    id: "p1",
    name: "منتج تجريبي",
    nameEn: "Sample product",
    thumbnailUrl: "https://cdn.example.test/p1.jpg",
    isVariantManaged: false,
    ...overrides,
  };
}

describe("Store Customizer — Featured real picker (CUST-H4-5)", () => {
  afterEach(() => cleanup());

  it("renders real candidate products from the list prop, not a raw id input", () => {
    render(
      <ControlPanels
        panel="homepage"
        config={withFeaturedSection([])}
        locale="ar"
        liveStoreName={null}
        onChange={() => {}}
        selectedSection="featured-1"
        featuredPickerListState="ready"
        featuredPickerList={[product({ id: "p1", name: "أول" }), product({ id: "p2", name: "ثاني" })]}
      />,
    );
    expect(screen.queryByLabelText(/معرّف المنتج/)).toBeNull();
    expect(screen.getByText("أول")).not.toBeNull();
    expect(screen.getByText("ثاني")).not.toBeNull();
  });

  it("shows a loading state while the candidate list is being fetched", () => {
    render(
      <ControlPanels
        panel="homepage"
        config={withFeaturedSection([])}
        locale="ar"
        liveStoreName={null}
        onChange={() => {}}
        selectedSection="featured-1"
        featuredPickerListState="loading"
      />,
    );
    expect(document.querySelector("[data-featured-picker-loading]")).not.toBeNull();
  });

  it("shows an honest empty state when no eligible products exist, with a retry on error", () => {
    const onRetry = vi.fn();
    render(
      <ControlPanels
        panel="homepage"
        config={withFeaturedSection([])}
        locale="ar"
        liveStoreName={null}
        onChange={() => {}}
        selectedSection="featured-1"
        featuredPickerListState="ready"
        featuredPickerList={[]}
      />,
    );
    expect(document.querySelector("[data-featured-picker-empty]")).not.toBeNull();

    cleanup();
    render(
      <ControlPanels
        panel="homepage"
        config={withFeaturedSection([])}
        locale="ar"
        liveStoreName={null}
        onChange={() => {}}
        selectedSection="featured-1"
        featuredPickerListState="error"
        onRetryFeaturedPickerList={onRetry}
      />,
    );
    const errorBox = document.querySelector("[data-featured-picker-error]");
    expect(errorBox).not.toBeNull();
    (errorBox?.querySelector("button") as HTMLButtonElement).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("selecting a candidate product adds its id, preserving existing selections", () => {
    const onChange = vi.fn();
    render(
      <ControlPanels
        panel="homepage"
        config={withFeaturedSection(["p1"])}
        locale="ar"
        liveStoreName={null}
        onChange={onChange}
        selectedSection="featured-1"
        featuredPickerListState="ready"
        featuredPickerList={[product({ id: "p1" }), product({ id: "p2", name: "ثاني" })]}
      />,
    );

    document.querySelector('[data-featured-option="p2"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as StorefrontPresentationConfig;
    const content = next.homepage.sections[0].content as { productIds: string[] };
    expect(content.productIds).toEqual(["p1", "p2"]);
  });

  it("clicking an already-selected candidate deselects it (toggle, no duplicates)", () => {
    const onChange = vi.fn();
    render(
      <ControlPanels
        panel="homepage"
        config={withFeaturedSection(["p1", "p2"])}
        locale="ar"
        liveStoreName={null}
        onChange={onChange}
        selectedSection="featured-1"
        featuredPickerListState="ready"
        featuredPickerList={[product({ id: "p1" }), product({ id: "p2" })]}
      />,
    );

    document.querySelector('[data-featured-option="p1"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    const next = onChange.mock.calls[0][0] as StorefrontPresentationConfig;
    const content = next.homepage.sections[0].content as { productIds: string[] } | undefined;
    expect(content?.productIds ?? []).toEqual(["p2"]);
  });

  it("removing a selected chip removes exactly that id and keeps the rest in order", () => {
    const onChange = vi.fn();
    render(
      <ControlPanels
        panel="homepage"
        config={withFeaturedSection(["p1", "p2", "p3"])}
        locale="ar"
        liveStoreName={null}
        onChange={onChange}
        selectedSection="featured-1"
        featuredPickerListState="ready"
        featuredPickerList={[]}
      />,
    );

    const items = document.querySelectorAll("[data-featured-selected-item]");
    expect(items).toHaveLength(3);
    const buttonsInSecond = items[1].querySelectorAll("button");
    const removeButtonInSecond = buttonsInSecond[buttonsInSecond.length - 1] as HTMLButtonElement;
    removeButtonInSecond.click();

    const next = onChange.mock.calls[0][0] as StorefrontPresentationConfig;
    const content = next.homepage.sections[0].content as { productIds: string[] };
    expect(content.productIds).toEqual(["p1", "p3"]);
  });

  it("enforces the maximum of 8 selected products — disables unselected candidates once the cap is hit", () => {
    const eightIds = Array.from({ length: 8 }, (_, i) => `p${i}`);
    render(
      <ControlPanels
        panel="homepage"
        config={withFeaturedSection(eightIds)}
        locale="ar"
        liveStoreName={null}
        onChange={() => {}}
        selectedSection="featured-1"
        featuredPickerListState="ready"
        featuredPickerList={[product({ id: "p9", name: "تاسع" }), product({ id: "p10", name: "عاشر" })]}
      />,
    );

    const candidate = document.querySelector('[data-featured-option="p9"]') as HTMLButtonElement;
    expect(candidate.disabled).toBe(true);
    expect(document.querySelectorAll('[data-featured-option]:not([disabled])')).toHaveLength(0);
  });

  it("an already-selected candidate stays clickable (removable) even at the cap", () => {
    const onChange = vi.fn();
    const eightIds = Array.from({ length: 8 }, (_, i) => `p${i}`);
    render(
      <ControlPanels
        panel="homepage"
        config={withFeaturedSection(eightIds)}
        locale="ar"
        liveStoreName={null}
        onChange={onChange}
        selectedSection="featured-1"
        featuredPickerListState="ready"
        featuredPickerList={eightIds.map((id) => product({ id }))}
      />,
    );

    const first = document.querySelector('[data-featured-option="p0"]') as HTMLButtonElement;
    expect(first.disabled).toBe(false);
    first.click();
    const next = onChange.mock.calls[0][0] as StorefrontPresentationConfig;
    const content = next.homepage.sections[0].content as { productIds: string[] };
    expect(content.productIds).toHaveLength(7);
    expect(content.productIds).not.toContain("p0");
  });

  it("reorders a selected product with the move-up/move-down controls", () => {
    const onChange = vi.fn();
    render(
      <ControlPanels
        panel="homepage"
        config={withFeaturedSection(["p1", "p2", "p3"])}
        locale="ar"
        liveStoreName={null}
        onChange={onChange}
        selectedSection="featured-1"
        featuredPickerListState="ready"
        featuredPickerList={[]}
      />,
    );

    const items = document.querySelectorAll("[data-featured-selected-item]");
    const moveDownOnFirst = items[0].querySelectorAll("button")[1] as HTMLButtonElement; // [up, down, remove]
    moveDownOnFirst.click();

    const next = onChange.mock.calls[0][0] as StorefrontPresentationConfig;
    const content = next.homepage.sections[0].content as { productIds: string[] };
    expect(content.productIds).toEqual(["p2", "p1", "p3"]);
  });

  it("shows the selected count against the maximum", () => {
    render(
      <ControlPanels
        panel="homepage"
        config={withFeaturedSection(["p1", "p2"])}
        locale="ar"
        liveStoreName={null}
        onChange={() => {}}
        selectedSection="featured-1"
        featuredPickerListState="ready"
        featuredPickerList={[]}
      />,
    );
    expect(document.querySelector('[data-featured-selected]')?.textContent).toContain("2/8");
  });

  it("supports typing in the search box via the provided callback", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(
      <ControlPanels
        panel="homepage"
        config={withFeaturedSection([])}
        locale="ar"
        liveStoreName={null}
        onChange={() => {}}
        selectedSection="featured-1"
        featuredPickerSearch=""
        featuredPickerListState="ready"
        featuredPickerList={[]}
        onFeaturedPickerSearchChange={onSearchChange}
      />,
    );
    const search = screen.getByLabelText("بحث عن منتج لإضافته");
    await user.type(search, "a");
    expect(onSearchChange).toHaveBeenCalledWith("a");
  });

  it("keyboard users can select a candidate (Enter activates the option button)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ControlPanels
        panel="homepage"
        config={withFeaturedSection([])}
        locale="ar"
        liveStoreName={null}
        onChange={onChange}
        selectedSection="featured-1"
        featuredPickerListState="ready"
        featuredPickerList={[product({ id: "p1" })]}
      />,
    );
    const option = screen.getByRole("option", { name: /منتج تجريبي/ });
    option.focus();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("conveys selection state semantically via aria-selected, and the list as a multi-select listbox", () => {
    render(
      <ControlPanels
        panel="homepage"
        config={withFeaturedSection(["p1"])}
        locale="ar"
        liveStoreName={null}
        onChange={() => {}}
        selectedSection="featured-1"
        featuredPickerListState="ready"
        featuredPickerList={[product({ id: "p1" }), product({ id: "p2", name: "ثاني" })]}
      />,
    );
    const listbox = screen.getByRole("listbox");
    expect(listbox.getAttribute("aria-multiselectable")).toBe("true");
    expect(screen.getByRole("option", { name: /منتج تجريبي/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("option", { name: /ثاني/ }).getAttribute("aria-selected")).toBe("false");
  });
});

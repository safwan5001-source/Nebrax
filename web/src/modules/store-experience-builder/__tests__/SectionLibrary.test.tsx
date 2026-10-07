/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SectionLibraryContent, SectionLibraryDialog } from "../SectionLibrary";
import {
  DEFAULT_PRESENTATION_CONFIG,
  MAX_HOME_SECTIONS,
  type PresentationHomeSection,
} from "../presentation";
import { customizerMessage, type CustomizerLocale } from "../messages";

afterEach(() => cleanup());

function renderLibrary(options?: {
  sections?: readonly PresentationHomeSection[];
  locale?: CustomizerLocale;
  onAdd?: (type: string) => void;
  onClose?: () => void;
}) {
  const locale = options?.locale ?? "ar";
  const t = (key: Parameters<typeof customizerMessage>[1]) =>
    customizerMessage(locale, key);
  const onAdd = options?.onAdd ?? vi.fn();
  const onClose = options?.onClose ?? vi.fn();
  render(
    <SectionLibraryDialog
      sections={options?.sections ?? DEFAULT_PRESENTATION_CONFIG.homepage.sections}
      t={t}
      onAdd={onAdd}
      onClose={onClose}
    />,
  );
  return { onAdd, onClose };
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function card(type: string): HTMLButtonElement {
  return dialog().querySelector(`[data-picker-option="${type}"]`) as HTMLButtonElement;
}

describe("CUST-H4-2 — Section Library UX", () => {
  it("opens successfully with the library title and every registered type reachable", () => {
    renderLibrary();
    expect(dialog()).toBeTruthy();
    expect(screen.getByText("مكتبة الأقسام")).toBeTruthy();
    for (const type of [
      "hero",
      "categories",
      "newArrivals",
      "wholesale",
      "banner",
      "featured",
      "offers",
      "benefits",
      "appPromo",
      "customContent",
    ]) {
      expect(card(type)).toBeTruthy();
    }
  });

  it("search filters by translated title/description and supports an empty-result state", async () => {
    const user = userEvent.setup();
    renderLibrary();
    const search = dialog().querySelector(
      "[data-section-library-search]",
    ) as HTMLInputElement;

    await user.type(search, "تطبيق");
    expect(card("appPromo")).toBeTruthy();
    expect(dialog().querySelector('[data-picker-option="banner"]')).toBeNull();

    await user.clear(search);
    await user.type(search, "لا-يوجد-قسم-بهذا-الاسم");
    expect(dialog().querySelector("[data-section-library-empty]")).toBeTruthy();
    expect(dialog().querySelectorAll("[data-picker-option]")).toHaveLength(0);
  });

  it("category filtering shows only that category's sections; unrelated category headings and cards disappear", async () => {
    const user = userEvent.setup();
    renderLibrary();
    // Default ("all") view groups cards under visible category headings.
    expect(
      within(dialog()).getByRole("heading", { name: "المحتوى" }),
    ).toBeTruthy();
    expect(card("customContent")).toBeTruthy();

    await user.click(
      screen.getByRole("button", { name: "العروض والتسويق" }),
    );
    expect(card("offers")).toBeTruthy();
    expect(card("wholesale")).toBeTruthy();
    expect(dialog().querySelector('[data-picker-option="hero"]')).toBeNull();
    expect(dialog().querySelector('[data-picker-option="customContent"]')).toBeNull();
    // The unrelated "Content" category's heading and section are both gone,
    // not merely hidden behind an always-empty-looking group.
    expect(
      within(dialog()).queryByRole("heading", { name: "المحتوى" }),
    ).toBeNull();
  });

  it("a singleton section already present is disabled with an 'already added' reason, not silently unclickable", async () => {
    renderLibrary();
    const categories = card("categories");
    expect(categories.disabled).toBe(true);
    expect(within(categories).getByText("أُضيف بالفعل")).toBeTruthy();
    // a hero is bounded per-instance (V6a): with one of its three it is still addable
    expect(card("hero").disabled).toBe(false);
  });

  it("a repeatable section can be added, calling onAdd with its type", async () => {
    const user = userEvent.setup();
    const { onAdd } = renderLibrary();
    const banner = card("banner");
    expect(banner.disabled).toBe(false);
    await user.click(banner);
    expect(onAdd).toHaveBeenCalledWith("banner");
  });

  it("the document-wide section cap disables every add, including non-singleton types, with the limit reason", () => {
    const sections: PresentationHomeSection[] = Array.from(
      { length: MAX_HOME_SECTIONS },
      (_, i) => ({ id: `s${i}`, type: "banner", visible: true }),
    );
    renderLibrary({ sections });
    const banner = card("banner");
    expect(banner.disabled).toBe(true);
    expect(within(banner).getByText("بلغت الحد الأقصى للأقسام.")).toBeTruthy();
  });

  it("disabled controls cannot mutate state — clicking a maxed-out card never calls onAdd", async () => {
    const user = userEvent.setup();
    const { onAdd } = renderLibrary();
    await user.click(card("categories"));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("Offers is LIVE (CUST-H4-7): visible, addable, with no gated badge or coming-soon reason", () => {
    renderLibrary();
    const offers = card("offers");
    expect(offers).toBeTruthy();
    expect(offers.disabled).toBe(false);
    expect(offers.dataset.sectionState).toBe("live");
    expect(within(offers).queryByText("غير مفعّل")).toBeNull();
    expect(within(dialog()).queryByText("غير مفعّل")).toBeNull();
    expect(within(offers).queryByText(/العروض قادمة/)).toBeNull();
  });

  it("clicking the Offers card calls onAdd('offers')", async () => {
    const user = userEvent.setup();
    const { onAdd } = renderLibrary();
    await user.click(card("offers"));
    expect(onAdd).toHaveBeenCalledWith("offers");
  });

  it("Featured is LIVE (CUST-H4-5) and addable, with no partial/gated badge — unaffected by the Offers transition", () => {
    renderLibrary();
    const featured = card("featured");
    expect(featured.disabled).toBe(false);
    expect(featured.dataset.sectionState).toBe("live");
    expect(within(featured).queryByText("قيد الإكمال")).toBeNull();
    expect(within(featured).queryByText("غير مفعّل")).toBeNull();
  });

  it("resolves Arabic and English labels without ever rendering a raw message key", () => {
    renderLibrary({ locale: "ar" });
    expect(screen.getByText("مكتبة الأقسام")).toBeTruthy();
    cleanup();
    renderLibrary({ locale: "en" });
    expect(screen.getByText("Section Library")).toBeTruthy();
    expect(within(card("categories")).getByText("Already added")).toBeTruthy();
  });

  it("Escape closes the dialog once focus is inside it (search is auto-focused on open)", async () => {
    const user = userEvent.setup();
    const { onClose } = renderLibrary();
    expect(document.activeElement).toBe(
      dialog().querySelector("[data-section-library-search]"),
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("clicking the backdrop closes the dialog", async () => {
    const user = userEvent.setup();
    const { onClose } = renderLibrary();
    const backdrop = document.querySelector(
      '[role="presentation"]',
    ) as HTMLElement;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });
});

describe("CUST-H4-2 review fix — SectionLibraryContent carries no dialog/modal role of its own", () => {
  it("renders with no role=dialog / aria-modal, so embedding it in an existing sheet never nests a second modal surface", () => {
    const t = (key: Parameters<typeof customizerMessage>[1]) =>
      customizerMessage("ar", key);
    render(
      <SectionLibraryContent
        sections={DEFAULT_PRESENTATION_CONFIG.homepage.sections}
        t={t}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const root = document.querySelector("[data-section-picker]") as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.getAttribute("role")).toBeNull();
    expect(root.getAttribute("aria-modal")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    // Still fully functional stand-alone: title, search and cards present.
    expect(screen.getByText("مكتبة الأقسام")).toBeTruthy();
    expect(root.querySelector('[data-section-library-search]')).toBeTruthy();
    expect(root.querySelector('[data-picker-option="banner"]')).toBeTruthy();
  });
});

describe("CUST-H4-2 review fix (mobile UX polish) — Back vs Close affordance", () => {
  function renderContent(closeAction?: "close" | "back", locale: CustomizerLocale = "ar") {
    const t = (key: Parameters<typeof customizerMessage>[1]) =>
      customizerMessage(locale, key);
    const onClose = vi.fn();
    render(
      <SectionLibraryContent
        sections={DEFAULT_PRESENTATION_CONFIG.homepage.sections}
        t={t}
        onAdd={vi.fn()}
        onClose={onClose}
        closeAction={closeAction}
      />,
    );
    const root = document.querySelector("[data-section-picker]") as HTMLElement;
    return { root, onClose };
  }

  it('defaults to "close" (desktop semantics) when closeAction is omitted', () => {
    const { root } = renderContent();
    expect(root.getAttribute("data-close-action")).toBe("close");
    expect(within(root).getByLabelText("إغلاق")).toBeTruthy();
    expect(within(root).queryByLabelText("رجوع")).toBeNull();
  });

  it('closeAction="back" renders a Back control (رجوع), not Close (إغلاق), and still calls onClose', async () => {
    const user = userEvent.setup();
    const { root, onClose } = renderContent("back");
    expect(root.getAttribute("data-close-action")).toBe("back");
    expect(within(root).queryByLabelText("إغلاق")).toBeNull();
    const back = within(root).getByLabelText("رجوع");
    expect(back.getAttribute("data-section-library-close-action")).toBe("back");
    await user.click(back);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closeAction="back" resolves the English label too, never a raw key', () => {
    const { root } = renderContent("back", "en");
    expect(within(root).getByLabelText("Back")).toBeTruthy();
    expect(within(root).queryByLabelText("Close")).toBeNull();
  });

  it("SectionLibraryDialog (desktop) always exposes a real Close control, never Back", () => {
    render(
      <SectionLibraryDialog
        sections={DEFAULT_PRESENTATION_CONFIG.homepage.sections}
        t={(key) => customizerMessage("ar", key)}
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const dialogEl = screen.getByRole("dialog");
    expect(dialogEl.querySelector("[data-section-picker]")?.getAttribute("data-close-action")).toBe(
      "close",
    );
    expect(within(dialogEl).getByLabelText("إغلاق")).toBeTruthy();
    expect(within(dialogEl).queryByLabelText("رجوع")).toBeNull();
  });
});

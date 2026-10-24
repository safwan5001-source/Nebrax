/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ listWorkspaceCategories: vi.fn(), listWorkspaceProducts: vi.fn() }));
vi.mock("@/modules/commerce-workspace/workspace-categories", () => ({ listWorkspaceCategories: workspace.listWorkspaceCategories }));
vi.mock("@/modules/commerce-workspace/workspace-products", () => ({ listWorkspaceProducts: workspace.listWorkspaceProducts }));

import { ControlPanels } from "../ControlPanels";
import { DEFAULT_PRESENTATION_CONFIG, normalizePresentationConfig, type StorefrontPresentationConfig } from "../presentation/config";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  workspace.listWorkspaceCategories.mockResolvedValue({ ok: true, hasMore: false, data: [{ id: "c1", name: "Shoes", parentId: null, parentName: null }] });
  workspace.listWorkspaceProducts.mockResolvedValue({ ok: true, hasMore: false, data: [] });
});

function Harness({ initial, spy }: { initial: StorefrontPresentationConfig; spy: (c: StorefrontPresentationConfig) => void }) {
  const [config, setConfig] = useState(initial);
  return (
    <ControlPanels
      panel="footer"
      config={config}
      locale="en"
      liveStoreName={null}
      storefrontId="sf1"
      onChange={(next) => {
        const normalised = normalizePresentationConfig(next);
        setConfig(normalised);
        spy(normalised);
      }}
    />
  );
}

function mount(initial: StorefrontPresentationConfig = DEFAULT_PRESENTATION_CONFIG) {
  const spy = vi.fn();
  render(<Harness initial={initial} spy={spy} />);
  return { last: () => spy.mock.calls.at(-1)?.[0] as StorefrontPresentationConfig };
}

describe("footer editor — layout (V7e-3)", () => {
  it("starts on the current footer; choosing a layout adds the key and the default removes it", async () => {
    const user = userEvent.setup();
    const { last } = mount();
    const select = screen.getByRole("combobox", { name: "Footer layout" });
    expect((select as HTMLSelectElement).value).toBe("");
    await user.selectOptions(select, "editorial");
    expect(last().footer.layout).toBe("editorial");
    await user.selectOptions(select, "");
    expect("layout" in last().footer).toBe(false);
  });
});

describe("footer editor — payment logos", () => {
  it("enables with safe defaults, selects, reorders and configures the display live", async () => {
    const user = userEvent.setup();
    const { last } = mount();
    expect("paymentLogos" in DEFAULT_PRESENTATION_CONFIG.footer).toBe(false);

    await user.click(screen.getByRole("checkbox", { name: "Show payment method logos" }));
    expect(last().footer.paymentLogos).toEqual({
      enabled: true,
      brands: ["mada", "visa", "mastercard", "apple_pay"],
      style: "cards",
      size: "md",
      showTitle: true,
    });

    await user.click(screen.getByRole("checkbox", { name: "Select Visa" }));
    expect(last().footer.paymentLogos?.brands).toEqual(["mada", "mastercard", "apple_pay"]);
    await user.click(screen.getByRole("button", { name: "Up Apple Pay" }));
    expect(last().footer.paymentLogos?.brands).toEqual(["mada", "apple_pay", "mastercard"]);

    await user.selectOptions(screen.getByRole("combobox", { name: "Display style" }), "strip");
    await user.selectOptions(screen.getByRole("combobox", { name: "Size" }), "lg");
    await user.click(screen.getByRole("checkbox", { name: "Show the “Payment methods” title" }));
    expect(last().footer.paymentLogos).toMatchObject({ style: "strip", size: "lg", showTitle: false });
  });
});

describe("footer editor — groups (V7e-3)", () => {
  it("adds a group, names it, adds links through the picker (never raw paths), moves and removes", async () => {
    const user = userEvent.setup();
    const { last } = mount();
    expect(screen.getByText(/No groups/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add group" }));
    await user.type(screen.getByRole("textbox", { name: "Group title" }), "Info");
    expect(last().footer.groups?.[0]?.title).toBe("Info");

    await user.click(screen.getByRole("button", { name: "Add link" }));
    const picker = document.querySelector("[data-nav-picker]") as HTMLElement;
    await user.click(within(picker).getByRole("tab", { name: "Page" }));
    await user.click(within(picker).getByRole("button", { name: /Privacy policy/ }));
    expect(last().footer.groups?.[0]?.links?.[0]).toMatchObject({ label: "Privacy policy", target: { kind: "content", slug: "privacy-policy" }, enabled: true });

    await user.click(screen.getByRole("button", { name: "Add link" }));
    const picker2 = document.querySelector("[data-nav-picker]") as HTMLElement;
    await user.click(within(picker2).getByRole("tab", { name: "Category" }));
    await user.click(await within(picker2).findByRole("option", { name: /^Shoes$/ }));
    expect(last().footer.groups?.[0]?.links?.map((l) => l.label)).toEqual(["Privacy policy", "Shoes"]);

    const rows = () => Array.from(document.querySelectorAll("[data-footer-link-row]")) as HTMLElement[];
    await user.click(within(rows()[1] as HTMLElement).getByRole("button", { name: "Up" }));
    expect(last().footer.groups?.[0]?.links?.map((l) => l.label)).toEqual(["Shoes", "Privacy policy"]);
    await user.click(within(rows()[0] as HTMLElement).getByRole("button", { name: "Remove" }));
    expect(last().footer.groups?.[0]?.links).toHaveLength(1);
  });

  it("a content page the storefront does not serve is disabled in the picker", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "Add group" }));
    await user.click(screen.getByRole("button", { name: "Add link" }));
    const picker = document.querySelector("[data-nav-picker]") as HTMLElement;
    await user.click(within(picker).getByRole("tab", { name: "Page" }));
    expect((within(picker).getByRole("button", { name: /About us/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a group can reference a menu instead; choosing own links drops the reference", async () => {
    const user = userEvent.setup();
    const config = normalizePresentationConfig({
      ...DEFAULT_PRESENTATION_CONFIG,
      navigation: { menus: [{ id: "main", name: "Header", items: [{ id: "a", label: "A", target: { kind: "home" } }] }] },
    });
    const { last } = mount(config);
    await user.click(screen.getByRole("button", { name: "Add group" }));
    const source = screen.getByRole("combobox", { name: "Links come from" });
    await user.selectOptions(source, "menu:main");
    expect(last().footer.groups?.[0]?.menu).toBe("main");
    expect(screen.queryByRole("button", { name: "Add link" })).toBeNull();
    await user.selectOptions(source, "own");
    expect("menu" in (last().footer.groups?.[0] ?? {})).toBe(false);
    expect(screen.getByRole("button", { name: "Add link" })).toBeTruthy();
  });

  it("width, reorder and remove (with confirmation only when the group has links)", async () => {
    const user = userEvent.setup();
    const { last } = mount();
    await user.click(screen.getByRole("button", { name: "Add group" }));
    await user.click(screen.getByRole("button", { name: "Add group" }));
    const titles = screen.getAllByRole("textbox", { name: "Group title" });
    await user.type(titles[0] as HTMLElement, "A");
    await user.type(titles[1] as HTMLElement, "B");
    await user.selectOptions(screen.getAllByRole("combobox", { name: "Group width" })[0] as HTMLElement, "2");
    expect(last().footer.groups?.[0]?.span).toBe(2);
    const cards = () => Array.from(document.querySelectorAll("[data-footer-group-card]")) as HTMLElement[];
    await user.click(within(cards()[1] as HTMLElement).getByRole("button", { name: "Up" }));
    expect(last().footer.groups?.map((g) => g.title)).toEqual(["B", "A"]);
    await user.click(within(cards()[0] as HTMLElement).getByRole("button", { name: "Remove group" }));
    expect(last().footer.groups?.map((g) => g.title)).toEqual(["A"]);
    // a group with links asks first
    await user.click(screen.getByRole("button", { name: "Add link" }));
    await user.click(within(document.querySelector("[data-nav-picker]") as HTMLElement).getAllByRole("button", { name: "Home" })[0] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Remove group" }));
    expect(screen.getByRole("alert").textContent).toContain("removed");
    expect(last().footer.groups).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Remove group" }));
    expect("groups" in last().footer).toBe(false);
  });

  it("at most six groups", async () => {
    const user = userEvent.setup();
    mount();
    for (let i = 0; i < 6; i++) await user.click(screen.getByRole("button", { name: "Add group" }));
    expect((screen.getByRole("button", { name: "Add group" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/maximum of 6 groups/)).toBeTruthy();
  });
});

describe("footer editor — design (V7e-3)", () => {
  it("structural selects write and clear their keys; the draft never holds an empty design", async () => {
    const user = userEvent.setup();
    const { last } = mount();
    const align = document.querySelector("[data-footer-design='align']") as HTMLSelectElement;
    await user.selectOptions(align, "center");
    expect(last().footer.design).toEqual({ align: "center" });
    await user.selectOptions(document.querySelector("[data-footer-design='spacing-top']") as HTMLSelectElement, "lg");
    expect(last().footer.design).toEqual({ spacing: { top: "lg" }, align: "center" });
    await user.selectOptions(align, "");
    await user.selectOptions(document.querySelector("[data-footer-design='spacing-top']") as HTMLSelectElement, "");
    expect("design" in last().footer).toBe(false);
  });

  it("shows the three colour fields and flags an explicit colour the footer cannot be read in", () => {
    mount(
      normalizePresentationConfig({
        ...DEFAULT_PRESENTATION_CONFIG,
        footer: { ...DEFAULT_PRESENTATION_CONFIG.footer, design: { surface: { background: { hex: "#f8fafc" } }, link: { hex: "#e2e8f0" } } },
      }),
    );
    for (const name of ["footer-bg", "footer-heading", "footer-text", "footer-link", "footer-divider"]) {
      expect(document.querySelector(`[data-colour-field="${name}"]`)).not.toBeNull();
    }
    expect(screen.getByText(/Contrast is too low/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Use the automatic colour" }).length).toBeGreaterThan(0);
  });

  it("an acceptable designed background shows no warning", async () => {
    await act(async () => {});
    mount(
      normalizePresentationConfig({
        ...DEFAULT_PRESENTATION_CONFIG,
        footer: { ...DEFAULT_PRESENTATION_CONFIG.footer, design: { surface: { background: { hex: "#12372a" } } } },
      }),
    );
    expect(screen.queryByText(/Contrast is too low/)).toBeNull();
  });
});

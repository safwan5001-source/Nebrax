/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({
  listWorkspaceCategories: vi.fn(),
  listWorkspaceProducts: vi.fn(),
}));
vi.mock("@/modules/commerce-workspace/workspace-categories", () => ({
  listWorkspaceCategories: workspace.listWorkspaceCategories,
}));
vi.mock("@/modules/commerce-workspace/workspace-products", () => ({
  listWorkspaceProducts: workspace.listWorkspaceProducts,
}));

import { ControlPanels } from "../ControlPanels";
import {
  DEFAULT_PRESENTATION_CONFIG,
  normalizePresentationConfig,
  type StorefrontPresentationConfig,
} from "../presentation/config";
import { mainMenu } from "../presentation/navigation";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  workspace.listWorkspaceCategories.mockResolvedValue({
    ok: true,
    hasMore: false,
    data: [
      { id: "c1", name: "Shoes", parentId: null, parentName: null },
      { id: "c2", name: "Heels", parentId: "c1", parentName: "Shoes" },
    ],
  });
  workspace.listWorkspaceProducts.mockResolvedValue({
    ok: true,
    hasMore: false,
    data: [{ id: "p1", name: "Red rose", nameEn: null, thumbnailUrl: null, isVariantManaged: false }],
  });
});

function Harness({ initial, spy }: { initial: StorefrontPresentationConfig; spy: (c: StorefrontPresentationConfig) => void }) {
  const [config, setConfig] = useState(initial);
  return (
    <ControlPanels
      panel="header"
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
  const last = () => spy.mock.calls.at(-1)?.[0] as StorefrontPresentationConfig;
  return { spy, last };
}

const withLegacy = (links: unknown[]) =>
  normalizePresentationConfig({ ...DEFAULT_PRESENTATION_CONFIG, header: { ...DEFAULT_PRESENTATION_CONFIG.header, links } });

describe("navigation editor — legacy → menu migration (V7d-4)", () => {
  it("without a main menu the legacy editor shows, with the explicit switch", () => {
    mount();
    expect(screen.getByText("Additional links")).toBeTruthy();
    expect(document.querySelector("[data-nav-migrate]")).not.toBeNull();
    expect(document.querySelector("[data-nav-panel-editor]")).toBeNull();
  });

  it("the switch converts exact links, keeps legacy links stored, and lists what it could not convert", async () => {
    const user = userEvent.setup();
    const { last } = mount(
      withLegacy([
        { id: "a", label: "Blog", kind: "external", href: "https://example.com/blog", enabled: true },
        { id: "b", label: "Shoes", kind: "category", href: "/c/shoes", enabled: true },
      ]),
    );
    await user.click(document.querySelector("[data-nav-migrate]") as HTMLElement);
    const menu = mainMenu(last().navigation);
    expect(menu?.items.map((i) => [i.label, i.target.kind])).toEqual([["Blog", "external"]]);
    expect(last().header.links).toHaveLength(2); // old versions / legacy data untouched
    expect(document.querySelector("[data-nav-panel-editor]")).not.toBeNull();
    expect(document.querySelector("[data-nav-migration-skipped]")?.textContent).toContain("Shoes");
  });
});

describe("navigation editor — items (V7d-4)", () => {
  async function startEmpty() {
    const user = userEvent.setup();
    const harness = mount(withLegacy([]));
    await user.click(document.querySelector("[data-nav-migrate]") as HTMLElement);
    return { user, ...harness };
  }

  it("adds a category through the picker, prefilling the label and resolving its name", async () => {
    const { user, last } = await startEmpty();
    await user.click(screen.getByRole("button", { name: "Add item" }));
    const picker = document.querySelector("[data-nav-picker]") as HTMLElement;
    await user.click(within(picker).getByRole("tab", { name: "Category" }));
    await user.click(await within(picker).findByRole("option", { name: /^Shoes$/ }));
    const item = mainMenu(last().navigation)?.items[0];
    expect(item).toMatchObject({ label: "Shoes", target: { kind: "category", id: "c1" }, enabled: true });
    expect(document.querySelector("[data-nav-picker]")).toBeNull();
    await waitFor(() => expect(document.querySelector("[data-nav-row]")?.textContent).toContain("Shoes"));
  });

  it("offers no raw internal path entry — only an https external link, validated", async () => {
    const { user, last } = await startEmpty();
    await user.click(screen.getByRole("button", { name: "Add item" }));
    const picker = document.querySelector("[data-nav-picker]") as HTMLElement;
    await user.click(within(picker).getByRole("tab", { name: "External link" }));
    const input = within(picker).getByPlaceholderText("https://");
    await user.type(input, "/internal/path");
    await user.click(within(picker).getByRole("button", { name: "Use link" }));
    expect(within(picker).getByRole("alert").textContent).toContain("https://");
    expect(mainMenu(last().navigation)?.items).toHaveLength(0);
    await user.clear(input);
    await user.type(input, "javascript:alert(1)");
    await user.click(within(picker).getByRole("button", { name: "Use link" }));
    expect(mainMenu(last().navigation)?.items).toHaveLength(0);
    await user.clear(input);
    await user.type(input, "https://example.com/x");
    await user.click(within(picker).getByRole("button", { name: "Use link" }));
    expect(mainMenu(last().navigation)?.items[0]?.target).toEqual({ kind: "external", href: "https://example.com/x", newTab: true });
  });

  it("content pages the storefront does not serve are listed but disabled", async () => {
    const { user } = await startEmpty();
    await user.click(screen.getByRole("button", { name: "Add item" }));
    const picker = document.querySelector("[data-nav-picker]") as HTMLElement;
    await user.click(within(picker).getByRole("tab", { name: "Page" }));
    expect((within(picker).getByRole("button", { name: /About us/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(picker).getByRole("button", { name: /Privacy policy/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("Escape closes the picker without adding", async () => {
    const { user, last } = await startEmpty();
    await user.click(screen.getByRole("button", { name: "Add item" }));
    await user.keyboard("{Escape}");
    expect(document.querySelector("[data-nav-picker]")).toBeNull();
    expect(mainMenu(last().navigation)?.items).toHaveLength(0);
  });

  async function addHomeTwice(user: ReturnType<typeof userEvent.setup>) {
    for (let i = 0; i < 2; i++) {
      await user.click(screen.getByRole("button", { name: "Add item" }));
      const picker = document.querySelector("[data-nav-picker]") as HTMLElement;
      await user.click(within(picker).getAllByRole("button", { name: "Home" })[0] as HTMLElement);
    }
  }

  it("Make child ↴ / Move out ↰, with the dropdown toggle appearing on the parent", async () => {
    const { user, last } = await startEmpty();
    await addHomeTwice(user);
    const rows = () => Array.from(document.querySelectorAll("[data-nav-row]")) as HTMLElement[];
    expect(rows()).toHaveLength(2);
    await user.click(within(rows()[1] as HTMLElement).getByRole("button", { name: "Make child ↴" }));
    const menu = mainMenu(last().navigation);
    expect(menu?.items).toHaveLength(1);
    expect(menu?.items[0]?.children).toHaveLength(1);
    expect(menu?.items[0]?.presentation).toEqual({ kind: "dropdown" });
    expect(document.querySelector("[data-nav-child-row]")).not.toBeNull();
    expect(screen.getAllByRole("checkbox", { name: "Show children as a dropdown" })).toHaveLength(1);
    await user.click(within(document.querySelector("[data-nav-child-row]") as HTMLElement).getByRole("button", { name: "Move out ↰" }));
    expect(mainMenu(last().navigation)?.items).toHaveLength(2);
  });

  it("removing a parent asks first; a childless item goes at once", async () => {
    const { user, last } = await startEmpty();
    await addHomeTwice(user);
    const rows = () => Array.from(document.querySelectorAll("[data-nav-row]")) as HTMLElement[];
    await user.click(within(rows()[1] as HTMLElement).getByRole("button", { name: "Make child ↴" }));
    await user.click(within(rows()[0] as HTMLElement).getByRole("button", { name: "Remove" }));
    expect(screen.getByRole("alert").textContent).toContain("children");
    expect(mainMenu(last().navigation)?.items).toHaveLength(1); // not yet
    await user.click(within(rows()[0] as HTMLElement).getByRole("button", { name: "Cancel" }));
    expect(mainMenu(last().navigation)?.items).toHaveLength(1);
    await user.click(within(rows()[0] as HTMLElement).getByRole("button", { name: "Remove" }));
    await user.click(within(rows()[0] as HTMLElement).getByRole("button", { name: "Remove" }));
    expect(mainMenu(last().navigation)?.items).toHaveLength(0);
  });

  it("icon and badge are editable and a cleared badge disappears", async () => {
    const { user, last } = await startEmpty();
    await user.click(screen.getByRole("button", { name: "Add item" }));
    await user.click(within(document.querySelector("[data-nav-picker]") as HTMLElement).getAllByRole("button", { name: "Home" })[0] as HTMLElement);
    await user.selectOptions(screen.getByRole("combobox", { name: "Icon" }), "tag");
    await user.type(screen.getByRole("textbox", { name: "Badge" }), "New");
    await user.selectOptions(screen.getByRole("combobox", { name: "Badge colour" }), "accent");
    expect(mainMenu(last().navigation)?.items[0]).toMatchObject({ icon: "tag", badge: { text: "New", tone: "accent" } });
    await user.clear(screen.getByRole("textbox", { name: "Badge" }));
    expect("badge" in (mainMenu(last().navigation)?.items[0] ?? {})).toBe(false);
  });

  it("warns on a deleted target and on a label-less item, exactly where the storefront would hide them", async () => {
    workspace.listWorkspaceCategories.mockResolvedValue({ ok: true, hasMore: false, data: [{ id: "c1", name: "Shoes", parentId: null, parentName: null }] });
    const config = normalizePresentationConfig({
      ...DEFAULT_PRESENTATION_CONFIG,
      navigation: {
        menus: [
          {
            id: "main",
            items: [
              { id: "a", label: "Shoes", target: { kind: "category", id: "c1" } },
              { id: "b", label: "Gone", target: { kind: "category", id: "zzz" } },
              { id: "c", label: "", target: { kind: "home" } },
              { id: "d", label: "About", target: { kind: "content", slug: "about" } },
            ],
          },
        ],
      },
    });
    mount(config);
    await waitFor(() => expect(document.querySelectorAll("[data-nav-problem]").length).toBe(3));
    const problems = Array.from(document.querySelectorAll("[data-nav-problem]"), (el) => el.getAttribute("data-nav-problem"));
    expect(problems.sort()).toEqual(["navLabelEmpty", "navTargetMissing", "navTargetUnserved"]);
  });

  it("a failed name lookup never claims a target is missing", async () => {
    workspace.listWorkspaceCategories.mockResolvedValue({ ok: false, reason: "failed", message: "x" });
    mount(
      normalizePresentationConfig({
        ...DEFAULT_PRESENTATION_CONFIG,
        navigation: { menus: [{ id: "main", items: [{ id: "b", label: "Gone", target: { kind: "category", id: "zzz" } }] }] },
      }),
    );
    await act(async () => {});
    expect(document.querySelectorAll("[data-nav-problem]").length).toBe(0);
  });
});

describe("navigation target picker — stale responses (V7d-4)", () => {
  it("a slow earlier search never overwrites a newer one", async () => {
    const user = userEvent.setup();
    let release!: (v: unknown) => void;
    workspace.listWorkspaceCategories.mockImplementation((_sf: string, params: { search?: string }) =>
      params.search === "sh"
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve({
            ok: true,
            hasMore: false,
            data: [{ id: "n", name: params.search ? "Newer result" : "Initial", parentId: null, parentName: null }],
          }),
    );
    mount(withLegacy([]));
    await user.click(document.querySelector("[data-nav-migrate]") as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Add item" }));
    const picker = document.querySelector("[data-nav-picker]") as HTMLElement;
    await user.click(within(picker).getByRole("tab", { name: "Category" }));
    const search = await within(picker).findByRole("searchbox");
    await user.type(search, "sh");
    await waitFor(() => expect(workspace.listWorkspaceCategories).toHaveBeenCalledWith("sf1", expect.objectContaining({ search: "sh" }), expect.anything()));
    await user.type(search, "x"); // "shx" supersedes the pending "sh"
    await within(picker).findByRole("option", { name: /Newer result/ });
    await act(async () => {
      release({ ok: true, hasMore: false, data: [{ id: "o", name: "Stale result", parentId: null, parentName: null }] });
    });
    expect(within(picker).queryByRole("option", { name: /Stale result/ })).toBeNull();
    expect(within(picker).getByRole("option", { name: /Newer result/ })).toBeTruthy();
  });

  it("shows an error with a retry", async () => {
    const user = userEvent.setup();
    workspace.listWorkspaceCategories.mockResolvedValueOnce({ ok: false, reason: "failed", message: "x" });
    mount(withLegacy([]));
    await user.click(document.querySelector("[data-nav-migrate]") as HTMLElement);
    await user.click(screen.getByRole("button", { name: "Add item" }));
    const picker = document.querySelector("[data-nav-picker]") as HTMLElement;
    await user.click(within(picker).getByRole("tab", { name: "Category" }));
    await within(picker).findByText("Could not load.");
    await user.click(within(picker).getByRole("button", { name: "Retry" }));
    await within(picker).findByRole("option", { name: /^Shoes$/ });
  });
});

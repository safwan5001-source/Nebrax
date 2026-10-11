import { describe, expect, it } from "vitest";
import {
  addItem,
  canAddProduct,
  canIndent,
  canMove,
  canOutdent,
  countItems,
  emptyMainMenu,
  indentItem,
  locate,
  MAX_NAV_PRODUCT_TARGETS,
  migrateLegacyLinks,
  moveItem,
  newItem,
  outdentItem,
  removeItem,
  setTarget,
  updateItem,
  withMainMenu,
} from "../navigation-edit";
import { MAX_NAV_CHILDREN, MAX_NAV_ITEMS, normalizeNavigation } from "../presentation/navigation";

const home = { kind: "home" } as const;

function menuOf(...labels: string[]) {
  let menu = emptyMainMenu();
  for (const label of labels) menu = addItem(menu, newItem(label, home));
  return menu;
}
const ids = (menu: ReturnType<typeof menuOf>) => menu.items.map((i) => i.label);
const idOf = (menu: ReturnType<typeof menuOf>, label: string) => menu.items.find((i) => i.label === label)?.id as string;

describe("navigation editing — structure (V7d-4)", () => {
  it("adds, updates and removes", () => {
    let menu = menuOf("A", "B");
    expect(ids(menu)).toEqual(["A", "B"]);
    menu = updateItem(menu, idOf(menu, "A"), { label: "A2", enabled: false });
    expect(menu.items[0]).toMatchObject({ label: "A2", enabled: false });
    menu = removeItem(menu, idOf(menu, "B"));
    expect(ids(menu)).toEqual(["A2"]);
  });

  it("an undefined patch clears icon / badge / presentation", () => {
    let menu = menuOf("A");
    const id = idOf(menu, "A");
    menu = updateItem(menu, id, { icon: "tag", badge: { text: "New" } });
    expect(menu.items[0]).toMatchObject({ icon: "tag", badge: { text: "New" } });
    menu = updateItem(menu, id, { icon: undefined, badge: undefined });
    expect("icon" in (menu.items[0] ?? {})).toBe(false);
    expect("badge" in (menu.items[0] ?? {})).toBe(false);
  });

  it("moves within siblings and refuses at the ends", () => {
    let menu = menuOf("A", "B", "C");
    expect(canMove(menu, idOf(menu, "A"), -1)).toBe(false);
    expect(canMove(menu, idOf(menu, "C"), 1)).toBe(false);
    menu = moveItem(menu, idOf(menu, "C"), -1);
    expect(ids(menu)).toEqual(["A", "C", "B"]);
    expect(moveItem(menu, idOf(menu, "A"), -1)).toBe(menu);
  });

  it("Make child: the item goes last under the one above, which becomes a dropdown", () => {
    let menu = menuOf("A", "B", "C");
    expect(canIndent(menu, idOf(menu, "A"))).toBe(false); // nothing above
    menu = indentItem(menu, idOf(menu, "B"));
    menu = indentItem(menu, idOf(menu, "C"));
    expect(ids(menu)).toEqual(["A"]);
    expect(menu.items[0]?.children?.map((c) => c.label)).toEqual(["B", "C"]);
    expect(menu.items[0]?.presentation).toEqual({ kind: "dropdown" });
  });

  it("an explicit link presentation is kept when children arrive", () => {
    let menu = menuOf("A", "B");
    menu = updateItem(menu, idOf(menu, "A"), { presentation: { kind: "link" } });
    menu = indentItem(menu, idOf(menu, "B"));
    expect(menu.items[0]?.presentation).toEqual({ kind: "link" });
  });

  it("depth stays one: a parent cannot become a child", () => {
    let menu = menuOf("A", "B", "C");
    menu = indentItem(menu, idOf(menu, "B")); // A > B
    expect(canIndent(menu, idOf(menu, "A"))).toBe(false);
    // C is below A (which has children) — it may become A's child, but A itself can never go under anything
    expect(canIndent(menu, idOf(menu, "C"))).toBe(true);
  });

  it("Move out: a child lands right after its parent and the parent loses the key when empty", () => {
    let menu = menuOf("A", "B", "C");
    menu = indentItem(menu, idOf(menu, "B"));
    const child = locate(menu, (menu.items[0]?.children?.[0] as { id: string }).id);
    expect(child?.parent?.label).toBe("A");
    expect(canOutdent(menu, (child?.item.id) as string)).toBe(true);
    menu = outdentItem(menu, (child?.item.id) as string);
    expect(ids(menu)).toEqual(["A", "B", "C"]);
    expect("children" in (menu.items[0] ?? {})).toBe(false);
  });

  it("removing the last child drops the children key", () => {
    let menu = menuOf("A", "B");
    menu = indentItem(menu, idOf(menu, "B"));
    const childId = menu.items[0]?.children?.[0]?.id as string;
    menu = removeItem(menu, childId);
    expect("children" in (menu.items[0] ?? {})).toBe(false);
  });

  it("children move among their siblings", () => {
    let menu = menuOf("A", "B", "C");
    menu = indentItem(menu, idOf(menu, "B"));
    menu = indentItem(menu, idOf(menu, "C"));
    const [b, c] = menu.items[0]?.children ?? [];
    expect(canMove(menu, (b as { id: string }).id, -1)).toBe(false);
    menu = moveItem(menu, (c as { id: string }).id, -1);
    expect(menu.items[0]?.children?.map((x) => x.label)).toEqual(["C", "B"]);
  });
});

describe("navigation editing — limits (V7d-4)", () => {
  it("refuses a 25th top-level item", () => {
    let menu = emptyMainMenu();
    for (let i = 0; i < MAX_NAV_ITEMS + 3; i++) menu = addItem(menu, newItem(`I${i}`, home));
    expect(menu.items).toHaveLength(MAX_NAV_ITEMS);
  });

  it("refuses a 13th child", () => {
    let menu = menuOf("P", ...Array.from({ length: MAX_NAV_CHILDREN + 2 }, (_, i) => `K${i}`));
    for (let i = 0; i < MAX_NAV_CHILDREN + 2; i++) menu = indentItem(menu, menu.items[1]?.id as string);
    expect(menu.items[0]?.children).toHaveLength(MAX_NAV_CHILDREN);
    expect(menu.items).toHaveLength(3); // P + the two that did not fit
  });

  it("outdent is refused when the top level is full", () => {
    let menu = menuOf("P", "K");
    menu = indentItem(menu, idOf(menu, "K"));
    for (let i = 0; i < MAX_NAV_ITEMS - 1; i++) menu = addItem(menu, newItem(`I${i}`, home));
    expect(menu.items).toHaveLength(MAX_NAV_ITEMS);
    expect(canOutdent(menu, menu.items[0]?.children?.[0]?.id as string)).toBe(false);
  });

  it("budgets product targets to what the storefront resolves", () => {
    let menu = emptyMainMenu();
    for (let i = 0; i < MAX_NAV_PRODUCT_TARGETS + 2; i++) {
      menu = addItem(menu, newItem(`P${i}`, { kind: "product", id: `p${i}` }));
    }
    expect(menu.items).toHaveLength(MAX_NAV_PRODUCT_TARGETS);
    expect(canAddProduct(menu)).toBe(false);
    // re-targeting a non-product item to a product is also refused; product → product is fine
    menu = addItem(menu, newItem("H", home));
    expect(setTarget(menu, idOf(menu, "H"), { kind: "product", id: "x" })).toBe(menu);
    expect(setTarget(menu, idOf(menu, "P0"), { kind: "product", id: "y" }).items[0]?.target).toEqual({ kind: "product", id: "y" });
  });

  it("countItems counts children too", () => {
    let menu = menuOf("A", "B");
    menu = indentItem(menu, idOf(menu, "B"));
    expect(countItems(menu)).toBe(2);
  });
});

describe("navigation editing — the edited menu survives the normaliser unchanged (V7d-4)", () => {
  it("what the editor produces is exactly what Publish would store", () => {
    let menu = menuOf("A", "B", "C");
    menu = updateItem(menu, idOf(menu, "A"), { icon: "tag", badge: { text: "New", tone: "accent" } });
    menu = indentItem(menu, idOf(menu, "B"));
    menu = addItem(menu, newItem("Pay", { kind: "external", href: "https://example.com/p", newTab: true }));
    menu = addItem(menu, newItem("Privacy", { kind: "content", slug: "privacy-policy" }));
    const doc = withMainMenu(undefined, menu);
    expect(normalizeNavigation(doc)).toEqual(doc);
  });

  it("withMainMenu keeps the other menus and puts main first", () => {
    const other = { id: "footer", name: "", items: [] };
    const doc = withMainMenu({ menus: [other] }, menuOf("A"));
    expect(doc.menus.map((m) => m.id)).toEqual(["main", "footer"]);
    expect(withMainMenu(doc, menuOf("B")).menus.map((m) => m.id)).toEqual(["main", "footer"]);
  });
});

describe("legacy header.links migration (V7d-4)", () => {
  const link = (over: Record<string, unknown>) => ({ id: "l", label: "X", kind: "home", href: "/", enabled: true, ...over }) as never;

  it("converts what maps exactly and reports what does not", () => {
    const { items, skipped } = migrateLegacyLinks([
      link({ label: "Home", kind: "home" }),
      link({ label: "Blog", kind: "external", href: "https://example.com/blog" }),
      link({ label: "Privacy", kind: "content", href: "/policies/privacy-policy" }),
      link({ label: "Contact", kind: "content", href: "contact" }),
      link({ label: "Shoes", kind: "category", href: "/c/shoes" }),
      link({ label: "Bad", kind: "external", href: "javascript:alert(1)" }),
      link({ label: "Odd", kind: "content", href: "/somewhere" }),
    ]);
    expect(items.map((i) => i.label)).toEqual(["Home", "Blog", "Privacy", "Contact"]);
    expect(items.map((i) => i.target.kind)).toEqual(["home", "external", "content", "content"]);
    expect(skipped).toEqual(["Shoes", "Bad", "Odd"]);
  });

  it("keeps a disabled link disabled; ignores the label-less default placeholder", () => {
    const { items, skipped } = migrateLegacyLinks([
      link({ label: "Off", enabled: false }),
      link({ label: "", id: "nav-home" }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.enabled).toBe(false);
    expect(skipped).toEqual([]);
  });

  it("the migrated menu normalises to itself", () => {
    const { items } = migrateLegacyLinks([link({ label: "Home" }), link({ label: "Blog", kind: "external", href: "https://example.com" })]);
    const doc = withMainMenu(undefined, { ...emptyMainMenu(), items });
    expect(normalizeNavigation(doc)).toEqual(doc);
  });
});

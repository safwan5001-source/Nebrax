import { describe, expect, it } from "vitest";
import {
  addGroup,
  addLink,
  canAddFooterProduct,
  canAddGroup,
  canAddLink,
  canMoveGroup,
  editLink,
  footerProductCount,
  moveGroup,
  newLink,
  removeGroup,
  setDesign,
  setGroups,
  setLayout,
  updateGroup,
  withFooterExtras,
} from "../footer-edit";
import { DEFAULT_PRESENTATION_CONFIG } from "../presentation/config";
import { normalizeFooterExtras } from "../presentation/footer-design";

const base = DEFAULT_PRESENTATION_CONFIG.footer;
const home = { kind: "home" } as const;

describe("footer editing — the writes always re-normalise (V7e-3)", () => {
  it("setting and clearing the layout adds and removes the key", () => {
    const withLayout = setLayout(base, "centered");
    expect(withLayout.layout).toBe("centered");
    expect(Object.keys(withLayout)).toEqual(["tagline", "showLogo", "copyright", "layout"]);
    expect("layout" in setLayout(withLayout, undefined)).toBe(false);
  });

  it("clearing the last design field removes `design`; an invalid value never gets in", () => {
    let footer = setDesign(base, { align: "center" });
    expect(footer.design).toEqual({ align: "center" });
    footer = setDesign(footer, { align: "left" as never });
    expect("design" in footer).toBe(false);
  });

  it("the legacy fields are never touched", () => {
    const footer = withFooterExtras({ ...base, tagline: "Hi", copyright: "c", showLogo: false }, { layout: "minimal" });
    expect(footer).toMatchObject({ tagline: "Hi", copyright: "c", showLogo: false, layout: "minimal" });
  });

  it("emptying the groups removes the key (the fixed columns return)", () => {
    const one = setGroups(base, addGroup(undefined));
    expect(one.groups).toHaveLength(1);
    expect("groups" in setGroups(one, [])).toBe(false);
  });

  it("what the editor produces is exactly what the normaliser would store", () => {
    let groups = addGroup(undefined);
    const id = groups[0]?.id as string;
    groups = updateGroup(groups, id, { title: "Info", span: 2 });
    groups = addLink(groups, id, newLink("Privacy", { kind: "content", slug: "privacy-policy" }));
    groups = addLink(groups, id, newLink("Blog", { kind: "external", href: "https://example.com/b", newTab: true }));
    const footer = withFooterExtras(base, { layout: "columns", groups, design: { surface: { background: { hex: "#0f172a" } } } });
    expect(normalizeFooterExtras(footer)).toEqual({ layout: footer.layout, groups: footer.groups, design: footer.design });
  });
});

describe("footer groups (V7e-3)", () => {
  it("at most six groups", () => {
    let groups = addGroup(undefined);
    for (let i = 0; i < 9; i++) groups = addGroup(groups);
    expect(groups).toHaveLength(6);
    expect(canAddGroup(groups)).toBe(false);
  });

  it("move and remove", () => {
    let groups = addGroup(addGroup(undefined));
    groups = updateGroup(groups, groups[0]?.id as string, { title: "A" });
    groups = updateGroup(groups, groups[1]?.id as string, { title: "B" });
    expect(canMoveGroup(groups, groups[0]?.id as string, -1)).toBe(false);
    groups = moveGroup(groups, groups[1]?.id as string, -1);
    expect(groups.map((g) => g.title)).toEqual(["B", "A"]);
    groups = removeGroup(groups, groups[0]?.id as string);
    expect(groups.map((g) => g.title)).toEqual(["A"]);
  });

  it("an undefined patch clears span / menu / links", () => {
    let groups = addGroup(undefined);
    const id = groups[0]?.id as string;
    groups = updateGroup(groups, id, { span: 2, menu: "main" });
    expect(groups[0]).toMatchObject({ span: 2, menu: "main" });
    groups = updateGroup(groups, id, { span: undefined, menu: undefined });
    expect("span" in (groups[0] ?? {})).toBe(false);
    expect("menu" in (groups[0] ?? {})).toBe(false);
  });

  it("choosing own links drops a referenced menu; emptying them drops `links`", () => {
    let groups = updateGroup(addGroup(undefined), addGroup(undefined)[0]?.id ?? "", {});
    groups = addGroup(undefined);
    const id = groups[0]?.id as string;
    groups = updateGroup(groups, id, { menu: "main" });
    groups = addLink(groups, id, newLink("Home", home));
    expect("menu" in (groups[0] ?? {})).toBe(false);
    const linkId = groups[0]?.links?.[0]?.id as string;
    groups = editLink.remove(groups, id, linkId);
    expect("links" in (groups[0] ?? {})).toBe(false);
  });

  it("at most eight links per group", () => {
    let groups = addGroup(undefined);
    const id = groups[0]?.id as string;
    for (let i = 0; i < 11; i++) groups = addLink(groups, id, newLink(`L${i}`, home));
    expect(groups[0]?.links).toHaveLength(8);
    expect(canAddLink(groups[0] as never)).toBe(false);
  });

  it("links move, update and retarget like menu items", () => {
    let groups = addGroup(undefined);
    const id = groups[0]?.id as string;
    groups = addLink(groups, id, newLink("A", home));
    groups = addLink(groups, id, newLink("B", home));
    const [a, b] = groups[0]?.links ?? [];
    groups = editLink.move(groups, id, (b as { id: string }).id, -1);
    expect(groups[0]?.links?.map((l) => l.label)).toEqual(["B", "A"]);
    groups = editLink.update(groups, id, (a as { id: string }).id, { label: "A2", enabled: false });
    expect(groups[0]?.links?.[1]).toMatchObject({ label: "A2", enabled: false });
    groups = editLink.retarget(groups, id, (a as { id: string }).id, { kind: "category", id: "c1" });
    expect(groups[0]?.links?.[1]?.target).toEqual({ kind: "category", id: "c1" });
  });

  it("the product budget (8) is shared across every group", () => {
    let groups = [...addGroup(addGroup(undefined))];
    const [g1, g2] = [groups[0]?.id as string, groups[1]?.id as string];
    for (let i = 0; i < 5; i++) groups = addLink(groups, g1, newLink(`P${i}`, { kind: "product", id: `p${i}` }));
    for (let i = 0; i < 5; i++) groups = addLink(groups, g2, newLink(`Q${i}`, { kind: "product", id: `q${i}` }));
    expect(footerProductCount(groups)).toBe(8);
    expect(canAddFooterProduct(groups)).toBe(false);
    // a non-product re-target to product is refused, product → product is fine
    groups = addLink(groups, g2, newLink("H", home));
    const homeId = groups[1]?.links?.find((l) => l.label === "H")?.id as string;
    expect(editLink.retarget(groups, g2, homeId, { kind: "product", id: "z" })[1]?.links?.find((l) => l.id === homeId)?.target.kind).toBe("home");
  });
});

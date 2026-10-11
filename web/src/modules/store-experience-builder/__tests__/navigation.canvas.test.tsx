/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PRESENTATION_CONFIG,
  normalizePresentationConfig,
  type StorefrontPresentationConfig,
} from "../presentation/config";
import { StorefrontPreviewCanvas } from "../StorefrontPreviewCanvas";

afterEach(cleanup);

function withNav(items: unknown[], extra: Record<string, unknown> = {}): StorefrontPresentationConfig {
  return normalizePresentationConfig({
    ...DEFAULT_PRESENTATION_CONFIG,
    header: {
      ...DEFAULT_PRESENTATION_CONFIG.header,
      links: [{ id: "legacy", label: "Legacy", kind: "home", href: "/", enabled: true }],
    },
    navigation: { menus: [{ id: "main", items }] },
    ...extra,
  });
}

function mount(config: StorefrontPresentationConfig, viewport: "desktop" | "mobile" = "desktop") {
  const { container } = render(<StorefrontPreviewCanvas config={config} locale="en" viewport={viewport} />);
  return container.querySelector("[data-preview-canvas]") as HTMLElement;
}

const labels = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("[data-extra-nav]"), (el) => el.textContent?.trim());

describe("Canvas navigation (V7d-3)", () => {
  it("without a navigation document the legacy header links draw as before", () => {
    const root = mount({
      ...DEFAULT_PRESENTATION_CONFIG,
      header: {
        ...DEFAULT_PRESENTATION_CONFIG.header,
        links: [{ id: "l", label: "Legacy", kind: "home", href: "/", enabled: true }],
      },
    });
    expect(labels(root)).toEqual(["Legacy"]);
  });

  it("a main menu supersedes the legacy links", () => {
    const root = mount(withNav([{ id: "a", label: "Shop", target: { kind: "home" } }]));
    expect(labels(root)).toEqual(["Shop"]);
  });

  it("an empty main menu still supersedes (no legacy resurrection)", () => {
    const root = mount(withNav([]));
    expect(labels(root)).toEqual([]);
  });

  it("omits disabled, label-less and unserved content-page items — exactly what the storefront omits", () => {
    const root = mount(
      withNav([
        { id: "a", label: "On", target: { kind: "home" } },
        { id: "b", label: "Off", target: { kind: "home" }, enabled: false },
        { id: "c", label: " ", target: { kind: "home" } },
        { id: "d", label: "About", target: { kind: "content", slug: "about" } },
        { id: "e", label: "Privacy", target: { kind: "content", slug: "privacy-policy" } },
      ]),
    );
    expect(labels(root)).toEqual(["On", "Privacy"]);
  });

  it("draws icon, badge, and a dropdown with its children", () => {
    const root = mount(
      withNav([
        {
          id: "shop",
          label: "Shop",
          icon: "tag",
          badge: { text: "New", tone: "accent" },
          target: { kind: "home" },
          presentation: { kind: "dropdown" },
          children: [
            { id: "k1", label: "Shoes", target: { kind: "category", id: "c1" } },
            { id: "k2", label: "Off", target: { kind: "home" }, enabled: false },
          ],
        },
      ]),
    );
    const group = root.querySelector("[data-nav-dropdown]") as HTMLElement;
    expect(group.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(group.querySelector("[data-nav-badge='accent']")?.textContent).toBe("New");
    expect(Array.from(group.querySelectorAll("[data-nav-child]"), (el) => el.textContent?.trim())).toEqual(["Shoes"]);
    expect(group.querySelector("[data-nav-panel]")?.className).toContain("start-0");
  });

  it("a link-presentation parent with children draws no dropdown", () => {
    const root = mount(
      withNav([
        {
          id: "p",
          label: "P",
          target: { kind: "home" },
          children: [{ id: "k", label: "K", target: { kind: "home" } }],
        },
      ]),
    );
    expect(root.querySelector("[data-nav-dropdown]")).toBeNull();
    expect(labels(root)).toEqual(["P"]);
  });

  it("the mobile Canvas draws no rail (as before)", () => {
    const root = mount(withNav([{ id: "a", label: "Shop", target: { kind: "home" } }]), "mobile");
    expect(labels(root)).toEqual([]);
  });
});

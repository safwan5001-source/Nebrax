import {
  Children,
  Fragment,
  type ReactElement,
  type ReactNode,
  Suspense,
} from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/lib/data/categories", () => ({ getCategories: vi.fn() }));
vi.mock("@/lib/commerce/storefront", () => ({
  fetchStorefrontName: vi.fn().mockResolvedValue("متجر الاختبار"),
}));
vi.mock("@/components/layout/Header", () => ({
  Header: () => null,
  HeaderMobileMenu: () => null,
}));
vi.mock("@/components/layout/Footer", () => ({
  Footer: () => null,
  FooterCategoryLinks: () => null,
}));
vi.mock("@/components/layout/MobileBottomNav", () => ({
  MobileBottomNav: () => null,
}));

import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import StorefrontLayout from "./layout";

interface LayoutElementProps {
  children?: ReactNode;
  mobileNavigation?: ReactElement<{ fallback: ReactNode }>;
  categoryNavigation?: ReactElement<{ fallback: ReactNode }>;
  categoryLinks?: ReactElement<{ fallback: ReactNode }>;
  fallback?: ReactNode;
  id?: string;
}

async function renderLayout(content: ReactNode) {
  const layout = (await StorefrontLayout({
    children: content,
    params: Promise.resolve({ country: "us", locale: "en" }),
  })) as ReactElement<LayoutElementProps>;

  expect(layout.type).toBe(Fragment);

  return Children.toArray(
    layout.props.children,
  ) as ReactElement<LayoutElementProps>[];
}

describe("StorefrontLayout", () => {
  it("keeps page chrome outside the category navigation Suspense boundaries", async () => {
    const content = <section>Storefront content</section>;
    const [header, main, footer] = await renderLayout(content);

    expect(header.type).toBe(Header);
    expect(main.type).toBe("main");
    expect(main.props.children).toBe(content);
    expect(footer.type).toBe(Footer);

    const mobileNavigation = header.props.mobileNavigation;
    const categoryNavigation = header.props.categoryNavigation;
    const categoryLinks = footer.props.categoryLinks;

    expect(mobileNavigation?.type).toBe(Suspense);
    expect(mobileNavigation?.props.fallback).not.toBeNull();
    expect(categoryNavigation?.type).toBe(Suspense);
    expect(categoryNavigation?.props.fallback).not.toBeNull();
    expect(categoryLinks?.type).toBe(Suspense);
    expect(categoryLinks?.props.fallback).not.toBeNull();
  });

  it("gives the skip link a target and renders the mobile bottom navigation last", async () => {
    const elements = await renderLayout(<section>Storefront content</section>);
    const main = elements.find((element) => element.type === "main");

    expect(main?.props.id).toBe("main-content");
    expect(elements.at(-1)?.type).toBe(MobileBottomNav);
  });
});

import {
  Children,
  Fragment,
  type ReactElement,
  type ReactNode,
  Suspense,
} from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock("@/lib/data/categories", () => ({ getCategories: vi.fn() }));
vi.mock("@/lib/commerce/storefront", () => ({
  fetchStorefrontName: vi.fn().mockResolvedValue("متجر الاختبار"),
  fetchStorefrontConfig: vi.fn().mockResolvedValue({
    name: "متجر الاختبار",
    default_locale: "ar",
    business_identity: {
      legal_name: "شركة الاختبار",
      cr_number: "7050247977",
      vat_number: null,
    },
    presentation: null,
  }),
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
vi.mock("@/components/layout/StoreWhatsApp", () => ({
  StoreWhatsApp: () => null,
}));

import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { PublishedCardStyleProvider } from "@/components/layout/PublishedCardStyle";
import { PublishedThemeMarkerProvider } from "@/components/layout/PublishedThemeMarker";
import { fetchStorefrontConfig } from "@/lib/commerce/storefront";
import { DEFAULT_PRESENTATION_CONFIG } from "@/lib/presentation/config";
import StorefrontLayout from "./layout";

interface LayoutElementProps {
  children?: ReactNode;
  mobileNavigation?: ReactElement<{ fallback: ReactNode }>;
  categoryNavigation?: ReactElement<{ fallback: ReactNode }>;
  categoryLinks?: ReactElement<{ fallback: ReactNode }>;
  fallback?: ReactNode;
  id?: string;
  businessIdentity?: unknown;
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
    const themeMarker = main.props.children as ReactElement<{
      themePreset: string;
      children: ReactNode;
    }>;
    expect(themeMarker.type).toBe(PublishedThemeMarkerProvider);
    expect(themeMarker.props.themePreset).toBe("awj-modern");
    const cardStyle = themeMarker.props.children as ReactElement<{
      productCard: string;
      children: ReactNode;
    }>;
    expect(cardStyle.type).toBe(PublishedCardStyleProvider);
    expect(cardStyle.props.productCard).toBe("standard");
    expect(cardStyle.props.children).toBe(content);
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

  it("passes canonical Tenant identity to the public Footer", async () => {
    const elements = await renderLayout(<section>Storefront content</section>);
    const footer = elements.find((element) => element.type === Footer);

    expect(footer?.props.businessIdentity).toEqual({
      legal_name: "شركة الاختبار",
      cr_number: "7050247977",
      vat_number: null,
    });
  });

  // CUST-H3-4 — StorefrontLayout computes identity/theme/appearance from
  // `presentation` alone, before it ever branches on `children`; Home,
  // Product and Category are nothing but different `children` passed into
  // this one layout. This proves that invariant directly against a
  // populated (non-default) config, instead of assuming it from the
  // null-presentation cases above.
  it("resolves identical identity/theme/appearance for Home, Product and Category — no page-specific identity authority", async () => {
    const populatedPresentation = {
      ...DEFAULT_PRESENTATION_CONFIG,
      primaryColor: "#7a2e8f",
      fontPreset: "tajawal-geist" as const,
      radius: "sharp" as const,
      productCard: "compact" as const,
      branding: {
        displayName: "ديوان الهدايا",
        logoDataUrl: "https://cdn.example.test/logo.png",
        compactLogoDataUrl: "https://cdn.example.test/logo-compact.png",
        faviconDataUrl: null,
      },
      header: {
        ...DEFAULT_PRESENTATION_CONFIG.header,
        style: "compact" as const,
      },
    };

    vi.mocked(fetchStorefrontConfig)
      .mockResolvedValueOnce({
        name: "متجر الاختبار",
        default_locale: "ar",
        business_identity: {
          legal_name: "شركة الاختبار",
          cr_number: "7050247977",
          vat_number: null,
        },
        presentation: populatedPresentation,
      })
      .mockResolvedValueOnce({
        name: "متجر الاختبار",
        default_locale: "ar",
        business_identity: {
          legal_name: "شركة الاختبار",
          cr_number: "7050247977",
          vat_number: null,
        },
        presentation: populatedPresentation,
      })
      .mockResolvedValueOnce({
        name: "متجر الاختبار",
        default_locale: "ar",
        business_identity: {
          legal_name: "شركة الاختبار",
          cr_number: "7050247977",
          vat_number: null,
        },
        presentation: populatedPresentation,
      });

    const pages = [
      <section key="home" data-fixture="home">
        Home
      </section>,
      <section key="product" data-fixture="product">
        Product
      </section>,
      <section key="category" data-fixture="category">
        Category
      </section>,
    ];

    interface ThemeWrapperProps {
      style?: Record<string, string>;
      children?: ReactNode;
      "data-published-theme"?: string;
    }

    const roots = await Promise.all(
      pages.map(
        (content) =>
          StorefrontLayout({
            children: content,
            params: Promise.resolve({ country: "sa", locale: "ar" }),
          }) as Promise<ReactElement<ThemeWrapperProps>>,
      ),
    );

    // Each page gets the theme wrapper div (not the no-presentation
    // Fragment branch), and all three carry the byte-identical resolved
    // style — same primary-color vars, same radius var, same font stack —
    // regardless of which page's content it wraps.
    for (const root of roots) {
      expect(root.type).toBe("div");
      expect(root.props["data-published-theme"]).toBe("");
    }
    const [homeStyle, productStyle, categoryStyle] = roots.map(
      (root) => root.props.style,
    );
    expect(homeStyle).toEqual(productStyle);
    expect(homeStyle).toEqual(categoryStyle);
    expect(homeStyle?.fontFamily).toContain("--font-geist-tajawal");
    expect(homeStyle?.fontFamily).not.toContain("--font-cairo");

    for (const [index, root] of roots.entries()) {
      const chromeFragment = root.props.children as ReactElement<{
        children: ReactNode;
      }>;
      expect(chromeFragment.type).toBe(Fragment);
      const chrome = Children.toArray(
        chromeFragment.props.children,
      ) as ReactElement<LayoutElementProps>[];
      const header = chrome.find((el) => el.type === Header) as ReactElement<{
        storeName: string;
        logoUrl: string | null;
        compact: boolean;
      }>;
      const footer = chrome.find((el) => el.type === Footer) as ReactElement<{
        storeName: string;
        logoUrl: string | null;
      }>;
      const main = chrome.find((el) => el.type === "main") as ReactElement<{
        children: ReactElement<{
          children: ReactElement<{ productCard: string; children: ReactNode }>;
        }>;
      }>;
      const themeMarker = main.props.children;
      const cardStyle = themeMarker.props.children;

      // Same resolved identity/appearance for Home, Product and Category alike.
      expect(header.props.storeName).toBe("ديوان الهدايا");
      expect(header.props.logoUrl).toBe(
        "https://cdn.example.test/logo-compact.png",
      );
      expect(header.props.compact).toBe(true);
      expect(footer.props.storeName).toBe("ديوان الهدايا");
      expect(footer.props.logoUrl).toBe(
        "https://cdn.example.test/logo-compact.png",
      );
      expect(cardStyle.props.productCard).toBe("compact");

      // And each page's own content still renders through untouched.
      const page = pages[index] as ReactElement<{ "data-fixture": string }>;
      expect(cardStyle.props.children).toBe(page);
    }
  });
});

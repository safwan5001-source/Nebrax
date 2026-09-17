import type { Category } from "@spree/sdk";
import Link from "next/link";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { POLICY_LINKS } from "@/lib/constants/policies";
import { isWholesaleEnabled } from "@/lib/spree";

interface FooterProps {
  basePath: string;
  locale: Locale;
  categoryLinks: ReactNode;
  storeName: string | null;
}

interface FooterCategoryLinksProps {
  rootCategories: Category[];
  basePath: string;
}

const footerLinkClassName =
  "text-sm text-store-muted-foreground transition-colors hover:text-store-foreground";

/**
 * How many categories the footer lists. A catalogue with forty root categories
 * would otherwise turn one footer column into a sitemap three times the height
 * of the others; the full tree stays one tap away behind "All products", the
 * category rail and the menu.
 */
const FOOTER_CATEGORY_LIMIT = 6;

export function FooterCategoryLinks({
  rootCategories,
  basePath,
}: FooterCategoryLinksProps) {
  return rootCategories.slice(0, FOOTER_CATEGORY_LIMIT).map((category) => (
    <li key={category.id}>
      <Link
        href={`${basePath}/c/${category.permalink}`}
        className={footerLinkClassName}
      >
        {category.name}
      </Link>
    </li>
  ));
}

interface FooterColumnProps {
  id: string;
  title: string;
  children: ReactNode;
}

function FooterColumn({ id, title, children }: FooterColumnProps) {
  return (
    <nav aria-labelledby={id}>
      <h2 id={id} className="text-sm font-semibold text-store-foreground">
        {title}
      </h2>
      <ul className="mt-4 space-y-2.5">{children}</ul>
    </nav>
  );
}

/**
 * The storefront footer.
 *
 * It carries only navigation the storefront actually has — categories from the
 * catalogue, the account routes, and the configured policy pages. There are no
 * service promises, payment marks, social accounts or contact details here,
 * because none of those are configured anywhere in AWJ yet and a footer is
 * exactly where an invented claim reads as a commitment.
 */
export async function Footer({
  basePath,
  locale,
  categoryLinks,
  storeName,
}: FooterProps) {
  const t = await getTranslations({ locale, namespace: "footer" });
  const tp = await getTranslations({ locale, namespace: "policies" });
  const wholesaleEnabled = isWholesaleEnabled();
  const displayName = storeName?.trim() || t("shop");
  await connection();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-store-border bg-store-surface-muted">
      <StoreContainer className="py-10 md:py-12">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3">
          <FooterColumn id="footer-shop" title={t("shop")}>
            <li>
              <Link
                href={`${basePath}/products`}
                className={footerLinkClassName}
              >
                {t("allProducts")}
              </Link>
            </li>
            {categoryLinks}
          </FooterColumn>

          <FooterColumn id="footer-account" title={t("account")}>
            <li>
              <Link
                href={`${basePath}/account`}
                className={footerLinkClassName}
              >
                {t("myAccount")}
              </Link>
            </li>
            <li>
              <Link
                href={`${basePath}/account/orders`}
                className={footerLinkClassName}
              >
                {t("orderHistory")}
              </Link>
            </li>
            <li>
              <Link href={`${basePath}/cart`} className={footerLinkClassName}>
                {t("cart")}
              </Link>
            </li>
            {wholesaleEnabled && (
              <li>
                <Link
                  href={`${basePath}/wholesale`}
                  className={footerLinkClassName}
                >
                  {t("wholesale")}
                </Link>
              </li>
            )}
          </FooterColumn>

          <FooterColumn id="footer-policies" title={t("policies")}>
            {POLICY_LINKS.map((policy) => (
              <li key={policy.slug}>
                <Link
                  href={`${basePath}/policies/${policy.slug}`}
                  className={footerLinkClassName}
                >
                  {tp(policy.nameKey)}
                </Link>
              </li>
            ))}
          </FooterColumn>
        </div>
      </StoreContainer>

      <div className="border-t border-store-border">
        <StoreContainer className="flex flex-col gap-1 py-5 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href={basePath || "/"}
            className="w-fit text-base font-semibold text-store-foreground"
          >
            <bdi>{displayName}</bdi>
          </Link>
          <p className="text-xs text-store-muted-foreground">
            © {year} <bdi>{displayName}</bdi>
          </p>
        </StoreContainer>
      </div>
    </footer>
  );
}

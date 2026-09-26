import type { Category } from "@spree/sdk";
import Link from "next/link";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { SbcSeal } from "@/components/layout/SbcSeal";
import { StoreBrand } from "@/components/layout/StoreBrand";
import { StoreContainer } from "@/components/layout/StoreContainer";
import { OfficialStoreBadge } from "@/components/store/OfficialStoreBadge";
import { POLICY_LINKS } from "@/lib/constants/policies";
import { isSafeAppStoreUrl, isSafePlayStoreUrl } from "@/lib/presentation/urls";
import { isWholesaleEnabled } from "@/lib/spree";

interface FooterProps {
  basePath: string;
  locale: Locale;
  categoryLinks: ReactNode;
  storeName: string | null;
  businessIdentity?: {
    legal_name: string | null;
    cr_number: string | null;
    vat_number: string | null;
  };
  showSbc?: boolean;
  sbcSealToken?: string;
  logoUrl?: string | null;
  showLogo?: boolean;
  tagline?: string;
  copyright?: string;
  contact?: {
    phone: string;
    email: string;
    address: string;
    hours: string;
  } | null;
  socialLinks?: { id: string; network: string; href: string }[];
  whatsappHref?: string | null;
  appLinks?: {
    id: string;
    store: "apple" | "google";
    label: string;
    href: string;
  }[];
  licenseNumber?: string;
}

interface FooterCategoryLinksProps {
  rootCategories: Category[];
  basePath: string;
}

/*
 * The global focus ring is a black outline, which is invisible on this band, so
 * the footer states its own.
 */
const footerLinkClassName =
  "text-sm text-store-footer-link transition-colors hover:text-store-footer-foreground focus-visible:outline-store-footer-foreground";

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
      <h2 id={id} className="text-sm font-bold text-store-footer-foreground">
        {title}
      </h2>
      <ul className="mt-4 space-y-2.5">{children}</ul>
    </nav>
  );
}

function TrustGroup({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <h2 id={id} className="text-sm font-bold text-store-footer-foreground">
        {title}
      </h2>
      <div className="mt-3 break-words">{children}</div>
    </section>
  );
}

/**
 * The storefront footer.
 *
 * A dark band closing the page, as the approved baseline draws it.
 *
 * It carries only navigation the storefront actually has — categories from the
 * catalogue, the account routes, and the configured policy pages. The
 * reference's about paragraph, payment marks and registration badge are absent:
 * none of them are configured anywhere in AWJ, and a footer is exactly where an
 * invented claim reads as a commitment.
 */
export async function Footer({
  basePath,
  locale,
  categoryLinks,
  storeName,
  businessIdentity = { legal_name: null, cr_number: null, vat_number: null },
  showSbc = false,
  sbcSealToken = "",
  logoUrl = null,
  showLogo = true,
  tagline = "",
  copyright = "",
  contact = null,
  socialLinks = [],
  whatsappHref = null,
  appLinks = [],
  licenseNumber = "",
}: FooterProps) {
  const t = await getTranslations({ locale, namespace: "footer" });
  const tp = await getTranslations({ locale, namespace: "policies" });
  const wholesaleEnabled = isWholesaleEnabled();
  const displayName = storeName?.trim() || t("shop");
  await connection();
  const year = new Date().getFullYear();
  const legalName = businessIdentity.legal_name?.trim() || null;
  const crNumber = businessIdentity.cr_number?.trim() || null;
  const vatNumber = businessIdentity.vat_number?.trim() || null;
  const license = licenseNumber.trim();
  const visibleAppLinks = appLinks.filter((link) =>
    link.store === "apple"
      ? isSafeAppStoreUrl(link.href)
      : isSafePlayStoreUrl(link.href),
  );
  const socialLabel = (network: string) => {
    switch (network) {
      case "instagram":
        return t("socialInstagram");
      case "x":
        return t("socialX");
      case "tiktok":
        return t("socialTiktok");
      case "snapchat":
        return t("socialSnapchat");
      case "youtube":
        return t("socialYoutube");
      case "linkedin":
        return t("socialLinkedin");
      case "facebook":
        return t("socialFacebook");
      default:
        return network;
    }
  };
  const hasContact = Boolean(
    contact?.phone || contact?.email || contact?.address || contact?.hours,
  );
  const hasBusinessIdentity = Boolean(legalName || crNumber || vatNumber);

  return (
    <footer className="bg-store-footer text-store-footer-link">
      <StoreContainer className="py-10 md:py-12">
        {/*
          Identity takes its own line above the navigation rather than a column
          beside it. The reference pairs the brand with an about paragraph and
          payment marks to fill that column; AWJ configures neither, and a lone
          wordmark in a quarter-width column reads as a gap where content was
          removed. Given the full measure it reads as the band's masthead, and
          the three real link groups then divide the width evenly.
        */}
        {showLogo ? (
          <StoreBrand
            href={basePath || "/"}
            name={displayName}
            tone="dark"
            size="md"
            logoUrl={logoUrl}
            className="focus-visible:outline-store-footer-foreground"
          />
        ) : (
          <p className="text-lg font-extrabold text-store-footer-foreground">
            <bdi>{displayName}</bdi>
          </p>
        )}
        {tagline.trim() ? (
          <p className="mt-3 max-w-lg break-words text-sm text-store-footer-muted">
            {tagline.trim()}
          </p>
        ) : null}

        <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-store-footer-border pt-8 sm:grid-cols-3">
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

        {(hasContact ||
          Boolean(whatsappHref) ||
          socialLinks.length > 0 ||
          hasBusinessIdentity ||
          license ||
          showSbc ||
          visibleAppLinks.length > 0) && (
          <div className="mt-8 grid grid-cols-1 gap-6 border-t border-store-footer-border pt-6 text-sm text-store-footer-muted sm:grid-cols-2">
            {hasBusinessIdentity ? (
              <TrustGroup id="footer-identity" title={t("businessInformation")}>
                {legalName ? (
                  <p>
                    {t("legalName")}: {legalName}
                  </p>
                ) : null}
                {crNumber ? (
                  <p>
                    {t("crNumber")}: {crNumber}
                  </p>
                ) : null}
                {vatNumber ? (
                  <p>
                    {t("vatNumber")}: {vatNumber}
                  </p>
                ) : null}
              </TrustGroup>
            ) : null}
            {license ? (
              <TrustGroup id="footer-license" title={t("merchantProvided")}>
                <p>
                  {t("licenseNumber")}: {license}
                </p>
              </TrustGroup>
            ) : null}
            {showSbc ? (
              <TrustGroup id="footer-sbc" title={t("sbcGroup")}>
                {sbcSealToken.trim() ? (
                  <SbcSeal
                    token={sbcSealToken}
                    fallbackLabel={t("sbcVerified")}
                  />
                ) : (
                  <p className="font-medium text-store-footer-link">
                    {t("sbcVerified")}
                  </p>
                )}
              </TrustGroup>
            ) : null}
            {hasContact || whatsappHref || socialLinks.length > 0 ? (
              <TrustGroup id="footer-communication" title={t("communication")}>
                {contact?.phone ? <p>{contact.phone}</p> : null}
                {contact?.email ? <p>{contact.email}</p> : null}
                {contact?.address ? <p>{contact.address}</p> : null}
                {contact?.hours ? <p>{contact.hours}</p> : null}
                {whatsappHref ? (
                  <p>
                    <a
                      href={whatsappHref}
                      className={footerLinkClassName}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t("whatsapp")}
                    </a>
                  </p>
                ) : null}
                {socialLinks.length > 0 ? (
                  <p className="mt-2 flex flex-wrap gap-3">
                    {socialLinks.map((item) => {
                      const label = socialLabel(item.network);
                      return (
                        <a
                          key={item.id}
                          href={item.href}
                          className="text-store-footer-link"
                          aria-label={label}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {label}
                        </a>
                      );
                    })}
                  </p>
                ) : null}
              </TrustGroup>
            ) : null}
            {visibleAppLinks.length > 0 ? (
              <TrustGroup id="footer-applications" title={t("applications")}>
                <div className="flex flex-wrap gap-3">
                  {visibleAppLinks.map((link) => (
                    <OfficialStoreBadge
                      key={link.id}
                      store={link.store}
                      href={link.href}
                      locale={locale}
                      label={link.label}
                    />
                  ))}
                </div>
              </TrustGroup>
            ) : null}
          </div>
        )}
      </StoreContainer>

      <div className="border-t border-store-footer-border">
        <StoreContainer className="py-5">
          <p className="break-words text-xs text-store-footer-muted">
            {copyright.trim() ? (
              copyright.trim()
            ) : (
              <>
                © {year} <bdi>{displayName}</bdi>
              </>
            )}
          </p>
        </StoreContainer>
      </div>
    </footer>
  );
}

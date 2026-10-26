import type { Category } from "@spree/sdk";
import Link from "next/link";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import {
  isOfficialSocialNetwork,
  OfficialSocialMark,
  officialSocialLinkClassName,
} from "@/components/brand/OfficialSocialMark";
import { FooterGroupDisclosure } from "@/components/layout/FooterGroupDisclosure";
import { FooterPaymentLogos } from "@/components/layout/FooterPaymentLogos";
import { NavItemContent } from "@/components/layout/NavItemContent";
import { SbcSeal } from "@/components/layout/SbcSeal";
import { StoreBrand } from "@/components/layout/StoreBrand";
import { StoreContainer } from "@/components/layout/StoreContainer";
import {
  ContactDetail,
  contactDetailText,
} from "@/components/store/ContactDetail";
import { IdentityDetail } from "@/components/store/IdentityDetail";
import { OfficialStoreBadge } from "@/components/store/OfficialStoreBadge";
import { POLICY_LINKS } from "@/lib/constants/policies";
import type {
  FooterLayout,
  ResolvedFooterDesign,
} from "@/lib/presentation/footer-design";
import type { MediaRef, ResolvedMedia } from "@/lib/presentation/media-ref";
import type {
  ResolvedFooterGroup,
  ResolvedNavChild,
} from "@/lib/presentation/navigation-resolve";
import type { FooterPaymentLogos as FooterPaymentLogosConfig } from "@/lib/presentation/payment-logos";
import { isSafeAppStoreUrl, isSafePlayStoreUrl } from "@/lib/presentation/urls";
import { isWholesaleEnabled } from "@/lib/spree";

interface FooterProps {
  basePath: string;
  /**
   * X4 — policy pages to link (the merchant-enabled ones in the published document). Omitted ⇒ all four, as
   * before; an empty list ⇒ the Policies column is not drawn. No API call per link.
   */
  policySlugs?: readonly string[];
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
  /** CUST-HV V4a — resolved media-library logo (see `StoreBrand`). */
  logoMedia?: { ref: MediaRef; media: ResolvedMedia } | null;
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
  /** CUST-HV V7e-2 — `footer.layout`; absent ⇒ the original stacked footer, byte for byte. */
  layout?: FooterLayout;
  /** CUST-HV V7e-2 — resolved link groups (`null` / absent ⇒ the fixed Shop · Account · Policies columns). */
  groups?: ResolvedFooterGroup[] | null;
  /** CUST-HV V7e-2 — resolved `footer.design` (colour variables, spacing, logo size, alignment). */
  design?: ResolvedFooterDesign;
  /** Display-only payment marks; independent from checkout gateways. */
  paymentLogos?: FooterPaymentLogosConfig;
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

/** `design.spacing` → the footer container's vertical padding (literal classes for Tailwind). */
const PAD_TOP = {
  sm: "pt-6 md:pt-8",
  md: "pt-10 md:pt-12",
  lg: "pt-14 md:pt-20",
} as const;
const PAD_BOTTOM = {
  sm: "pb-6 md:pb-8",
  md: "pb-10 md:pb-12",
  lg: "pb-14 md:pb-20",
} as const;
/** `design.align` → the brand block's text alignment (logical, so it mirrors under RTL). */
const ALIGN = {
  start: "items-start text-start",
  center: "items-center text-center",
  end: "items-end text-end",
} as const;
const ALIGN_ROW = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
} as const;

/** A touch-sized link for the layouts that draw links in rows (V0 §10.2: targets ≥ 44 px). */
const rowLinkClassName = `${footerLinkClassName} inline-flex min-h-11 items-center gap-1.5`;

function GroupLink({ item }: { item: ResolvedNavChild }) {
  const content = (
    <NavItemContent label={item.label} icon={item.icon} badge={item.badge} />
  );
  return (
    <li>
      {item.newTab ? (
        <a
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          className={rowLinkClassName}
        >
          {content}
        </a>
      ) : (
        <Link href={item.href} className={rowLinkClassName}>
          {content}
        </Link>
      )}
    </li>
  );
}

interface FooterGroupView {
  id: string;
  title: string;
  span: 1 | 2;
  /** The group's `<li>` nodes. */
  nodes: ReactNode;
  /** The same links one by one, for the layouts that draw a single row (and the minimal line's first three). */
  flat: ReactNode[];
}

/**
 * The storefront footer.
 *
 * A dark band closing the page, as the approved baseline draws it.
 *
 * It carries only navigation the storefront actually has — categories from the
 * catalogue, the account routes, and the configured policy pages. Optional
 * payment marks are merchant-authored visual Beta content and do not claim or
 * configure checkout acceptance. Commercial registration and the VAT number
 * are canonical tenant facts with AWJ utility icons, not official seals.
 *
 * CUST-HV V7e-2: with no `layout`, `groups` or `design` the footer below is the
 * original one, unchanged. A merchant-chosen `layout` redraws the same data (no
 * content is duplicated or dropped — identity and verification show at every
 * width); `groups` replace the three fixed columns; `design` re-points the footer
 * colour tokens (validated hex only) and sets spacing / logo size / alignment.
 */
export async function Footer({
  basePath,
  policySlugs,
  locale,
  categoryLinks,
  storeName,
  businessIdentity = { legal_name: null, cr_number: null, vat_number: null },
  showSbc = false,
  sbcSealToken = "",
  logoUrl = null,
  logoMedia = null,
  showLogo = true,
  tagline = "",
  copyright = "",
  contact = null,
  socialLinks = [],
  whatsappHref = null,
  appLinks = [],
  licenseNumber = "",
  layout,
  groups = null,
  design,
  paymentLogos,
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
  const visibleSocial = socialLinks.filter(
    (item) => Boolean(item.href) && isOfficialSocialNetwork(item.network),
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
  const phone = contactDetailText(contact?.phone);
  const email = contactDetailText(contact?.email);
  const address = contactDetailText(contact?.address);
  const hours = contactDetailText(contact?.hours);
  const hasContact = Boolean(phone || email || address || hours);
  const hasBusinessIdentity = Boolean(legalName || crNumber || vatNumber);

  // Which layout draws the footer. `legacy` is the original stacked footer (also used when only `groups` / `design` are set).
  const kind: FooterLayout | "legacy" = layout ?? "legacy";
  const resolved: ResolvedFooterDesign = design ?? {
    spacing: { top: "md", bottom: "md" },
    logoSize: undefined,
    align: undefined,
    designed: false,
  };
  // The layouts that draw social marks / WhatsApp / app badges themselves keep them out of the trust grid (no duplication).
  const socialOutside =
    kind === "compact" || kind === "centered" || kind === "minimal";
  const bandOutside = kind === "brand-heavy";
  const showSocialInTrust = visibleSocial.length > 0 && !socialOutside;
  const showWhatsappInTrust = Boolean(whatsappHref) && !bandOutside;
  const showAppsInTrust = visibleAppLinks.length > 0 && !bandOutside;

  const socialMarks = (
    <div className="flex flex-wrap items-center gap-1">
      {visibleSocial.map((item) => {
        const label = socialLabel(item.network);
        return (
          <a
            key={item.id}
            href={item.href}
            className={officialSocialLinkClassName}
            aria-label={label}
            target="_blank"
            rel="noopener noreferrer"
          >
            <OfficialSocialMark network={item.network} />
          </a>
        );
      })}
    </div>
  );

  const whatsappLink = whatsappHref ? (
    <p>
      <a
        href={whatsappHref}
        className={`${footerLinkClassName} inline-flex min-h-11 items-center gap-2`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <OfficialSocialMark network="whatsapp" />
        {t("whatsapp")}
      </a>
    </p>
  ) : null;

  const appBadges = (
    <div className="flex flex-wrap items-center gap-3">
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
  );

  const brandMark = showLogo ? (
    <StoreBrand
      href={basePath || "/"}
      name={displayName}
      tone="dark"
      size="md"
      {...(resolved.logoSize ? { scale: resolved.logoSize } : {})}
      logoUrl={logoUrl}
      logoMedia={logoMedia}
      locale={locale}
      className="focus-visible:outline-store-footer-foreground"
    />
  ) : (
    <p className="text-lg font-extrabold text-store-footer-foreground">
      <bdi>{displayName}</bdi>
    </p>
  );

  const taglineText = tagline.trim();

  // ── link groups: the merchant's, else the three fixed ones ────────────────────────────────────────────────
  const defaultGroups: FooterGroupView[] = [];
  const linkClass = kind === "legacy" ? footerLinkClassName : rowLinkClassName;
  const accountNodes: ReactNode[] = [
    <li key="account">
      <Link href={`${basePath}/account`} className={linkClass}>
        {t("myAccount")}
      </Link>
    </li>,
    <li key="orders">
      <Link href={`${basePath}/account/orders`} className={linkClass}>
        {t("orderHistory")}
      </Link>
    </li>,
    <li key="cart">
      <Link href={`${basePath}/cart`} className={linkClass}>
        {t("cart")}
      </Link>
    </li>,
    ...(wholesaleEnabled
      ? [
          <li key="wholesale">
            <Link href={`${basePath}/wholesale`} className={linkClass}>
              {t("wholesale")}
            </Link>
          </li>,
        ]
      : []),
  ];
  const policyNodes: ReactNode[] = POLICY_LINKS.filter(
    (policy) => !policySlugs || policySlugs.includes(policy.slug),
  ).map((policy) => (
    <li key={policy.slug}>
      <Link href={`${basePath}/policies/${policy.slug}`} className={linkClass}>
        {tp(policy.nameKey)}
      </Link>
    </li>
  ));
  const shopLink = (
    <li key="all-products">
      <Link href={`${basePath}/products`} className={linkClass}>
        {t("allProducts")}
      </Link>
    </li>
  );
  defaultGroups.push(
    {
      id: "footer-shop",
      title: t("shop"),
      span: 1,
      nodes: (
        <>
          {shopLink}
          {categoryLinks}
        </>
      ),
      flat: [shopLink, categoryLinks],
    },
    {
      id: "footer-account",
      title: t("account"),
      span: 1,
      nodes: accountNodes,
      flat: accountNodes,
    },
  );
  if (policyNodes.length > 0) {
    defaultGroups.push({
      id: "footer-policies",
      title: t("policies"),
      span: 1,
      nodes: policyNodes,
      flat: policyNodes,
    });
  }

  const groupViews: FooterGroupView[] = groups
    ? groups.map((group) => ({
        id: `footer-g-${group.id}`,
        title: group.title,
        span: group.span,
        nodes: group.items.map((item) => (
          <GroupLink key={item.id} item={item} />
        )),
        flat: group.items.map((item) => (
          <GroupLink key={item.id} item={item} />
        )),
      }))
    : defaultGroups;

  // ── the trust / contact grid: identical content in every layout ───────────────────────────────────────────
  const hasTrust =
    hasContact ||
    showWhatsappInTrust ||
    showSocialInTrust ||
    hasBusinessIdentity ||
    Boolean(license) ||
    showSbc ||
    showAppsInTrust;

  const trustBlock = hasTrust ? (
    <div
      {...(layout ? { "data-footer-trust": "" } : {})}
      className="mt-8 grid grid-cols-1 gap-x-8 gap-y-8 border-t border-store-footer-border pt-6 text-sm text-store-footer-muted sm:grid-cols-2 lg:grid-cols-3"
    >
      {hasBusinessIdentity ? (
        <TrustGroup id="footer-identity" title={t("businessInformation")}>
          {legalName ? (
            <p className="break-words">
              {t("legalName")}: {legalName}
            </p>
          ) : null}
          <IdentityDetail kind="cr" label={t("crNumber")} value={crNumber} />
          <IdentityDetail kind="vat" label={t("vatNumber")} value={vatNumber} />
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
            <SbcSeal token={sbcSealToken} fallbackLabel={t("sbcVerified")} />
          ) : (
            <p className="font-medium text-store-footer-link">
              {t("sbcVerified")}
            </p>
          )}
        </TrustGroup>
      ) : null}
      {hasContact || showWhatsappInTrust || showSocialInTrust ? (
        <TrustGroup id="footer-communication" title={t("communication")}>
          <div className="space-y-2">
            {phone ? <ContactDetail kind="phone" value={phone} /> : null}
            {email ? <ContactDetail kind="email" value={email} /> : null}
            {address ? <ContactDetail kind="address" value={address} /> : null}
            {hours ? <ContactDetail kind="hours" value={hours} /> : null}
            {showWhatsappInTrust ? whatsappLink : null}
            {showSocialInTrust ? socialMarks : null}
          </div>
        </TrustGroup>
      ) : null}
      {showAppsInTrust ? (
        <TrustGroup id="footer-applications" title={t("applications")}>
          {appBadges}
        </TrustGroup>
      ) : null}
    </div>
  ) : null;

  const bottomBar = (
    <div className="border-t border-store-footer-border">
      <StoreContainer className="py-5">
        <p
          className={[
            "break-words text-xs text-store-footer-muted",
            resolved.align === "center"
              ? "text-center"
              : resolved.align === "end"
                ? "text-end"
                : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
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
  );

  const footerProps = {
    className: "bg-store-footer text-store-footer-link",
    ...(resolved.style ? { style: resolved.style as React.CSSProperties } : {}),
    ...(layout ? { "data-footer-layout": layout } : {}),
  };
  const pad = `${PAD_TOP[resolved.spacing.top]} ${PAD_BOTTOM[resolved.spacing.bottom]}`;
  const brandAlign =
    ALIGN[resolved.align ?? (kind === "centered" ? "center" : "start")];
  const rowAlign =
    ALIGN_ROW[resolved.align ?? (kind === "centered" ? "center" : "start")];

  const linkRow = (nodes: ReactNode, label: string) => (
    <nav aria-label={label}>
      <ul className={`flex flex-wrap gap-x-5 gap-y-0 ${rowAlign}`}>{nodes}</ul>
    </nav>
  );
  const groupNavs = (collapseFrom: number, columnsClass?: string) =>
    groupViews.map((group, index) => (
      <div
        key={group.id}
        className={`min-w-0 ${group.span === 2 ? "col-span-2 lg:col-span-2" : ""} ${
          index >= collapseFrom ? "col-span-full md:col-span-1" : ""
        } ${columnsClass ?? ""}`}
      >
        <FooterGroupDisclosure
          id={group.id}
          title={group.title}
          collapsible={index >= collapseFrom}
          headingClassName="text-sm font-bold text-store-footer-foreground"
          listClassName="mt-1 md:mt-3"
        >
          {group.nodes}
        </FooterGroupDisclosure>
      </div>
    ));

  // ── the six layouts (V0 §10.2) and the original ──────────────────────────────────────────────────────────
  let body: ReactNode;
  if (kind === "legacy") {
    body = (
      <>
        {brandMark}
        {taglineText ? (
          <p className="mt-3 max-w-lg break-words text-sm text-store-footer-muted">
            {taglineText}
          </p>
        ) : null}

        <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-store-footer-border pt-8 sm:grid-cols-3">
          {groups
            ? groupViews.map((group) => (
                <FooterColumn key={group.id} id={group.id} title={group.title}>
                  {group.nodes}
                </FooterColumn>
              ))
            : defaultGroups.map((group) => (
                <FooterColumn key={group.id} id={group.id} title={group.title}>
                  {group.nodes}
                </FooterColumn>
              ))}
        </div>
        {trustBlock}
      </>
    );
  } else if (kind === "compact") {
    body = (
      <>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className={`flex min-w-0 flex-col gap-2 ${brandAlign}`}>
            {brandMark}
            {taglineText ? (
              <p className="max-w-sm break-words text-sm text-store-footer-muted">
                {taglineText}
              </p>
            ) : null}
          </div>
          {linkRow(
            groupViews.flatMap((g) => g.flat),
            t("quickLinks"),
          )}
          {visibleSocial.length > 0 ? socialMarks : null}
        </div>
        {trustBlock}
      </>
    );
  } else if (kind === "centered") {
    body = (
      <div className={`flex flex-col gap-6 ${brandAlign}`}>
        {brandMark}
        {taglineText ? (
          <p className="max-w-lg break-words text-sm text-store-footer-muted">
            {taglineText}
          </p>
        ) : null}
        {linkRow(
          groupViews.flatMap((g) => g.flat),
          t("quickLinks"),
        )}
        {visibleSocial.length > 0 ? socialMarks : null}
        <div className="w-full text-start">{trustBlock}</div>
      </div>
    );
  } else if (kind === "minimal") {
    body = (
      <>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <p className="break-words text-xs text-store-footer-muted">
            {copyright.trim() ? (
              copyright.trim()
            ) : (
              <>
                © {year} <bdi>{displayName}</bdi>
              </>
            )}
          </p>
          {linkRow(
            groupViews.flatMap((g) => g.flat).slice(0, 3),
            t("quickLinks"),
          )}
          {visibleSocial.length > 0 ? socialMarks : null}
        </div>
        {trustBlock}
      </>
    );
  } else if (kind === "editorial") {
    body = (
      <>
        <div className="grid gap-10 lg:grid-cols-12">
          <div
            className={`flex min-w-0 flex-col gap-4 lg:col-span-5 ${brandAlign}`}
          >
            {brandMark}
            {taglineText ? (
              <p className="break-words text-2xl font-semibold leading-snug text-store-footer-foreground md:text-3xl">
                {taglineText}
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:col-span-7">
            {groupNavs(99)}
          </div>
        </div>
        {trustBlock}
      </>
    );
  } else if (kind === "brand-heavy") {
    body = (
      <>
        <section
          aria-label={displayName}
          data-footer-band=""
          className={`flex flex-col gap-5 border-b border-store-footer-border pb-8 ${brandAlign}`}
        >
          {brandMark}
          {taglineText ? (
            <p className="max-w-xl break-words text-base text-store-footer-muted">
              {taglineText}
            </p>
          ) : null}
          <div className={`flex flex-wrap items-center gap-3 ${rowAlign}`}>
            <Link
              href={`${basePath}/products`}
              className="inline-flex min-h-11 items-center rounded-store bg-store-footer-foreground px-5 text-sm font-bold text-store-footer focus-visible:outline-store-footer-foreground"
            >
              {t("allProducts")}
            </Link>
            {whatsappLink}
            {visibleAppLinks.length > 0 ? appBadges : null}
          </div>
        </section>
        <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-3 lg:grid-cols-4">
          {groupViews.map((group) => (
            <div
              key={group.id}
              className={`min-w-0 ${group.span === 2 ? "lg:col-span-2" : ""}`}
            >
              <FooterGroupDisclosure
                id={group.id}
                title={group.title}
                collapsible
                headingClassName="text-sm font-bold text-store-footer-foreground"
                listClassName="mt-1 md:mt-3"
              >
                {group.nodes}
              </FooterGroupDisclosure>
            </div>
          ))}
        </div>
        {trustBlock}
      </>
    );
  } else {
    // columns: brand block + up to four groups on the first row, identity / contact beneath
    body = (
      <>
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-3 lg:grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))]">
          <div
            className={`col-span-full flex min-w-0 flex-col gap-3 lg:col-span-1 ${brandAlign}`}
          >
            {brandMark}
            {taglineText ? (
              <p className="max-w-sm break-words text-sm text-store-footer-muted">
                {taglineText}
              </p>
            ) : null}
          </div>
          {groupNavs(4)}
        </div>
        {trustBlock}
      </>
    );
  }

  const minimal = kind === "minimal";
  return (
    <footer {...footerProps}>
      <StoreContainer
        className={
          kind === "legacy" && !resolved.designed ? "py-10 md:py-12" : pad
        }
      >
        {body}
        <FooterPaymentLogos
          settings={paymentLogos}
          title={t("paymentMethods")}
          align={resolved.align}
        />
      </StoreContainer>
      {minimal ? null : bottomBar}
    </footer>
  );
}

"use client";

import { ChevronDown } from "lucide-react";
import { type CSSProperties, type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { type CanvasFooterGroup, canvasFooterGroups, Inner } from "./CanvasNav";
import { ContactDetail } from "./ContactDetail";
import { IdentityDetail } from "./IdentityDetail";
import type { CustomizerMessageKey } from "./messages";
import { OfficialSocialMark, officialSocialLinkClassName } from "./OfficialSocialMark";
import { OfficialStoreBadge } from "./OfficialStoreBadge";
import { type FooterColourContext, type FooterLayout, resolveFooterDesign } from "./presentation/footer-design";
import type { StorefrontPresentationConfig } from "./presentation/config";
import { SbcSeal } from "./SbcSeal";
import { StoreBrand, storeContainerClassName } from "./StoreBrand";

type Chrome = "branding" | "social" | "whatsapp" | "footer";

export interface CanvasFooterProps {
  config: StorefrontPresentationConfig;
  t: (key: CustomizerMessageKey) => string;
  locale: "ar" | "en";
  viewport: "desktop" | "tablet" | "mobile";
  storeName: string;
  logo: string | null;
  onSelectChrome?: (chrome: never) => void;
  selectedChrome?: string | null;
  /** Titles of the enabled content pages (the legacy "policies" column). */
  pageTitles: string[];
  contact: { phone: string; email: string; address: string; hours: string };
  footerWhatsapp: string | null;
  social: Array<{ id: string; network: string; href: string; label: string }>;
  identity: { legalName: string | null; crNumber: string | null; vatNumber: string | null; has: boolean };
  apps: { ios: string | null; android: string | null; has: boolean };
  /** Published root categories, already storefront-scoped and ordered. */
  categories: Array<{ id: string; name: string }>;
  colourContext: FooterColourContext;
}

/** The literal class maps the storefront Footer uses (kept identical so the Canvas draws what Publish draws). */
const PAD_TOP = { sm: "pt-6 md:pt-8", md: "pt-10 md:pt-12", lg: "pt-14 md:pt-20" } as const;
const PAD_BOTTOM = { sm: "pb-6 md:pb-8", md: "pb-10 md:pb-12", lg: "pb-14 md:pb-20" } as const;
const ALIGN = { start: "items-start text-start", center: "items-center text-center", end: "items-end text-end" } as const;
const ALIGN_ROW = { start: "justify-start", center: "justify-center", end: "justify-end" } as const;
const LINK = "inline-flex min-h-11 items-center gap-1.5 text-sm text-store-footer-link";

function Group({
  group,
  collapsible,
  mobile,
}: {
  group: CanvasFooterGroup;
  collapsible: boolean;
  mobile: boolean;
}) {
  const [open, setOpen] = useState(false);
  const disclosure = collapsible && mobile;
  return (
    <div data-footer-group="" data-collapsed={disclosure && !open ? "" : undefined} className="min-w-0">
      <h2 className="text-sm font-bold text-store-footer-foreground">
        {disclosure ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={(event) => {
              event.stopPropagation();
              setOpen((value) => !value);
            }}
            className="flex min-h-11 w-full items-center justify-between gap-2 text-start"
          >
            <span>{group.title}</span>
            <ChevronDown aria-hidden className={cn("size-4 shrink-0", open && "rotate-180")} />
          </button>
        ) : (
          group.title
        )}
      </h2>
      <ul hidden={disclosure && !open} className="mt-1 md:mt-3">
        {group.items.map((item) => (
          <li key={item.id}>
            <span className={LINK}>
              <Inner item={item} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * CUST-HV V7e-3 — the Canvas footer: the original preview footer when the document sets no `layout`, `groups` or `design` (its
 * markup is the one the Canvas always drew), otherwise the six layouts of V0 §10.2 over the same data, drawn exactly as the
 * storefront `Footer` draws them (same class sets, same blocks, same derived colours). The Canvas resolves its breakpoints from
 * the `viewport` prop, never from `md:` / `lg:` prefixes — the host browser's width is not the simulated device's.
 */
export function CanvasFooter(props: CanvasFooterProps) {
  const { config, t, locale, viewport, storeName, logo, onSelectChrome, selectedChrome } = props;
  const { contact, footerWhatsapp, social, identity, apps, pageTitles, categories } = props;
  const footer = config.footer;
  const layout: FooterLayout | undefined = footer.layout;
  const groups = canvasFooterGroups(footer, config.navigation?.menus ?? []);
  const design = resolveFooterDesign(footer.design, props.colourContext);
  const kind: FooterLayout | "legacy" = layout ?? "legacy";
  const mobile = viewport === "mobile";
  const desktop = viewport === "desktop";

  const hasPhone = Boolean(contact.phone);
  const hasContact = hasPhone || Boolean(contact.email) || Boolean(contact.address) || Boolean(contact.hours);
  const socialOutside = kind === "compact" || kind === "centered" || kind === "minimal";
  const bandOutside = kind === "brand-heavy";
  const showSocialInTrust = social.length > 0 && !socialOutside;
  const showWhatsappInTrust = Boolean(footerWhatsapp) && !bandOutside;
  const showAppsInTrust = apps.has && config.apps.showFooterLinks && !bandOutside;
  const licence = config.verification.licenseNumber.trim();
  const hasTrust =
    hasContact || showWhatsappInTrust || showSocialInTrust || identity.has || Boolean(licence) || config.sbc.show_in_storefront || showAppsInTrust;

  const select = (chrome: Chrome) => (event: { stopPropagation: () => void; preventDefault?: () => void }) => {
    event.preventDefault?.();
    event.stopPropagation();
    (onSelectChrome as ((c: Chrome) => void) | undefined)?.(chrome);
  };

  const brandMark = footer.showLogo ? (
    <button
      type="button"
      data-preview-chrome={onSelectChrome ? "branding" : undefined}
      aria-label={onSelectChrome ? t("branding") : undefined}
      onClick={onSelectChrome ? select("branding") : undefined}
      className="inline-flex min-w-0 max-w-full"
    >
      <StoreBrand href="#preview" name={storeName} tone="dark" size="md" logoUrl={logo} linked={!onSelectChrome} />
    </button>
  ) : null;

  const taglineText = footer.tagline.trim();

  const socialMarks = (
    <div className="flex flex-wrap items-center gap-1">
      {social.map((item) => (
        <a
          key={item.id}
          href={item.href}
          aria-label={item.label}
          data-preview-chrome="social"
          className={officialSocialLinkClassName}
          onClick={select("social")}
        >
          <OfficialSocialMark network={item.network} />
        </a>
      ))}
    </div>
  );

  const whatsappLink = footerWhatsapp ? (
    <p>
      <a
        href={footerWhatsapp}
        data-preview-chrome="whatsapp"
        className="inline-flex min-h-11 items-center gap-2 text-store-footer-link underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--store-footer-foreground)]"
        onClick={select("whatsapp")}
      >
        <OfficialSocialMark network="whatsapp" />
        {t("whatsapp")}
      </a>
    </p>
  ) : null;

  const appBadges = (
    <div className="flex flex-wrap items-center gap-3">
      {apps.ios ? (
        <OfficialStoreBadge store="apple" href={apps.ios} locale={locale} label="App Store" onClick={(event) => event.preventDefault()} />
      ) : null}
      {apps.android ? (
        <OfficialStoreBadge store="google" href={apps.android} locale={locale} label="Google Play" onClick={(event) => event.preventDefault()} />
      ) : null}
    </div>
  );

  const trustColumns = mobile ? "grid-cols-1" : desktop ? "grid-cols-3" : "grid-cols-2";
  const trustBlock = hasTrust ? (
    <div
      data-footer-trust=""
      className={cn(
        "mt-8 grid gap-x-8 gap-y-8 border-t border-store-footer-border pt-6 text-sm text-store-footer-muted",
        kind === "legacy" ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : trustColumns,
      )}
    >
      {identity.has ? (
        <section className="min-w-0">
          <h3 className="text-sm font-bold text-store-footer-foreground">{t("businessInformation")}</h3>
          <div className="mt-3 break-words">
            {identity.legalName ? (
              <p className="break-words">
                {t("legalName")}: {identity.legalName}
              </p>
            ) : null}
            <IdentityDetail kind="cr" label={t("crNumber")} value={identity.crNumber} />
            <IdentityDetail kind="vat" label={t("vatNumber")} value={identity.vatNumber} />
          </div>
        </section>
      ) : null}
      {licence ? (
        <section className="min-w-0">
          <h3 className="text-sm font-bold text-store-footer-foreground">{t("merchantProvided")}</h3>
          <p className="mt-3 break-words">
            {t("licenseNumber")}: {config.verification.licenseNumber}
          </p>
        </section>
      ) : null}
      {config.sbc.show_in_storefront ? (
        <section className="min-w-0">
          <h3 className="text-sm font-bold text-store-footer-foreground">{t("sbcGroup")}</h3>
          <div className="mt-3">
            {config.sbc.seal_token.trim() ? (
              <SbcSeal message={t("sbcSealPreview")} />
            ) : (
              <p className="font-medium text-store-footer-link">{t("sbcVerified")}</p>
            )}
          </div>
        </section>
      ) : null}
      {hasContact || showWhatsappInTrust || showSocialInTrust ? (
        <section className="min-w-0">
          <h3 className="text-sm font-bold text-store-footer-foreground">{t("communication")}</h3>
          <div className="mt-3 space-y-2 break-words">
            {contact.phone ? <ContactDetail kind="phone" value={contact.phone} /> : null}
            {contact.email ? <ContactDetail kind="email" value={contact.email} /> : null}
            {contact.address ? <ContactDetail kind="address" value={contact.address} /> : null}
            {contact.hours ? <ContactDetail kind="hours" value={contact.hours} /> : null}
            {showWhatsappInTrust ? whatsappLink : null}
            {showSocialInTrust ? socialMarks : null}
          </div>
        </section>
      ) : null}
      {showAppsInTrust ? (
        <section className="min-w-0">
          <h3 className="text-sm font-bold text-store-footer-foreground">{t("applications")}</h3>
          <div className="mt-3">{appBadges}</div>
        </section>
      ) : null}
    </div>
  ) : null;

  const copyright = footer.copyright.trim() || `© ${storeName}`;
  const bottomBar = (
    <div className="border-t border-store-footer-border">
      <div className={cn(storeContainerClassName, "py-5")}>
        <p
          className={cn(
            "break-words text-xs text-store-footer-muted",
            design.align === "center" && "text-center",
            design.align === "end" && "text-end",
          )}
        >
          {copyright}
        </p>
      </div>
    </div>
  );

  const brandAlign = ALIGN[design.align ?? (kind === "centered" ? "center" : "start")];
  const rowAlign = ALIGN_ROW[design.align ?? (kind === "centered" ? "center" : "start")];

  const flatLinks = (list: CanvasFooterGroup[]) =>
    list.flatMap((g) => g.items).map((item) => (
      <li key={`${item.id}`}>
        <span className={LINK}>
          <Inner item={item} />
        </span>
      </li>
    ));

  // the fixed columns, as the preview has always drawn them (also the source of the flat link row when no `groups` are set)
  const legacyColumns = (
    <>
      <FooterCol title={t("shop")}>
        <span>{t("allProducts")}</span>
        {categories.slice(0, 6).map((category) => (
          <span key={category.id}>{category.name}</span>
        ))}
      </FooterCol>
      <FooterCol title={t("account")}>
        <span>{t("account")}</span>
        <span>{t("cart")}</span>
      </FooterCol>
      <FooterCol title={t("policies")}>
        {pageTitles.length ? pageTitles.map((title) => <span key={title}>{title}</span>) : <span>{t("pagesHint")}</span>}
      </FooterCol>
    </>
  );
  const fixedAsGroups: CanvasFooterGroup[] = [
    { id: "shop", title: t("shop"), span: 1, items: [] },
    { id: "account", title: t("account"), span: 1, items: [] },
    { id: "policies", title: t("policies"), span: 1, items: [] },
  ];

  const linkRow = (nodes: ReactNode) => (
    <nav aria-label={t("quickLinks")}>
      <ul className={cn("flex flex-wrap gap-x-5 gap-y-0", rowAlign)}>{nodes}</ul>
    </nav>
  );
  const fixedFlat = [t("allProducts"), t("account"), t("cart"), ...pageTitles].map((label) => (
    <li key={label}>
      <span className={LINK}>{label}</span>
    </li>
  ));
  const flatNodes = groups ? flatLinks(groups) : fixedFlat;

  const groupViews = (collapseFrom: number) =>
    (groups ?? fixedAsGroups).map((group, index) => (
      <div key={group.id} className={cn("min-w-0", group.span === 2 && "col-span-2", index >= collapseFrom && mobile && "col-span-full")}>
        {groups ? (
          <Group group={group} collapsible={index >= collapseFrom} mobile={mobile} />
        ) : (
          <FooterCol title={group.title}>
            {group.id === "shop" ? (
              <>
                <span>{t("allProducts")}</span>
                {categories.slice(0, 6).map((category) => (
                  <span key={category.id}>{category.name}</span>
                ))}
              </>
            ) : group.id === "account" ? (
              <>
                <span>{t("account")}</span>
                <span>{t("cart")}</span>
              </>
            ) : pageTitles.length ? (
              pageTitles.map((title) => <span key={title}>{title}</span>)
            ) : (
              <span>{t("pagesHint")}</span>
            )}
          </FooterCol>
        )}
      </div>
    ));

  let body: ReactNode;
  if (kind === "legacy") {
    body = (
      <>
        {brandMark}
        {taglineText ? <p className="mt-3 max-w-lg break-words text-sm text-store-footer-muted">{footer.tagline}</p> : null}
        <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-store-footer-border pt-8 sm:grid-cols-3">
          {groups
            ? groups.map((group) => (
                <FooterCol key={group.id} title={group.title}>
                  {group.items.map((item) => (
                    <span key={item.id} className="flex items-center gap-1.5">
                      <Inner item={item} />
                    </span>
                  ))}
                </FooterCol>
              ))
            : legacyColumns}
        </div>
        {trustBlock}
      </>
    );
  } else if (kind === "compact") {
    body = (
      <>
        <div className={cn("flex flex-col gap-6", desktop && "flex-row items-center justify-between")}>
          <div className={cn("flex min-w-0 flex-col gap-2", brandAlign)}>
            {brandMark}
            {taglineText ? <p className="max-w-sm break-words text-sm text-store-footer-muted">{footer.tagline}</p> : null}
          </div>
          {linkRow(flatNodes)}
          {social.length > 0 ? socialMarks : null}
        </div>
        {trustBlock}
      </>
    );
  } else if (kind === "centered") {
    body = (
      <div className={cn("flex flex-col gap-6", brandAlign)}>
        {brandMark}
        {taglineText ? <p className="max-w-lg break-words text-sm text-store-footer-muted">{footer.tagline}</p> : null}
        {linkRow(flatNodes)}
        {social.length > 0 ? socialMarks : null}
        <div className="w-full text-start">{trustBlock}</div>
      </div>
    );
  } else if (kind === "minimal") {
    body = (
      <>
        <div className={cn("flex flex-col gap-3", desktop && "flex-row items-center justify-between")}>
          <p className="break-words text-xs text-store-footer-muted">{copyright}</p>
          {linkRow(flatNodes.slice(0, 3))}
          {social.length > 0 ? socialMarks : null}
        </div>
        {trustBlock}
      </>
    );
  } else if (kind === "editorial") {
    body = (
      <>
        <div className={cn("grid gap-10", desktop && "grid-cols-12")}>
          <div className={cn("flex min-w-0 flex-col gap-4", desktop && "col-span-5", brandAlign)}>
            {brandMark}
            {taglineText ? (
              <p className="break-words text-2xl font-semibold leading-snug text-store-footer-foreground md:text-3xl">{footer.tagline}</p>
            ) : null}
          </div>
          <div className={cn("grid grid-cols-2 gap-x-6 gap-y-8", desktop && "col-span-7")}>{groupViews(99)}</div>
        </div>
        {trustBlock}
      </>
    );
  } else if (kind === "brand-heavy") {
    body = (
      <>
        <section aria-label={storeName} data-footer-band="" className={cn("flex flex-col gap-5 border-b border-store-footer-border pb-8", brandAlign)}>
          {brandMark}
          {taglineText ? <p className="max-w-xl break-words text-base text-store-footer-muted">{footer.tagline}</p> : null}
          <div className={cn("flex flex-wrap items-center gap-3", rowAlign)}>
            <span className="inline-flex min-h-11 items-center rounded-store bg-store-footer-foreground px-5 text-sm font-bold text-store-footer">
              {t("allProducts")}
            </span>
            {whatsappLink}
            {apps.has && config.apps.showFooterLinks ? appBadges : null}
          </div>
        </section>
        <div className={cn("mt-8 grid gap-x-6 gap-y-6", mobile ? "grid-cols-2" : desktop ? "grid-cols-4" : "grid-cols-3")}>{groupViews(0)}</div>
        {trustBlock}
      </>
    );
  } else {
    body = (
      <>
        <div className={cn("grid gap-x-6 gap-y-8", mobile ? "grid-cols-2" : desktop ? "grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))]" : "grid-cols-3")}>
          <div className={cn("flex min-w-0 flex-col gap-3", !desktop && "col-span-full", brandAlign)}>
            {brandMark}
            {taglineText ? <p className="max-w-sm break-words text-sm text-store-footer-muted">{footer.tagline}</p> : null}
          </div>
          {groupViews(4)}
        </div>
        {trustBlock}
      </>
    );
  }

  const pad = `${PAD_TOP[design.spacing.top]} ${PAD_BOTTOM[design.spacing.bottom]}`;
  const designed = design.designed || kind !== "legacy";

  return (
    <footer
      className={cn(
        "bg-store-footer text-store-footer-link",
        onSelectChrome && "awj-preview-section",
        selectedChrome === "footer" && "awj-preview-section-selected",
      )}
      style={design.style as CSSProperties | undefined}
      data-footer-layout={layout}
      data-preview-chrome={onSelectChrome ? "footer" : undefined}
      data-chrome-selected={onSelectChrome && selectedChrome === "footer" ? "" : undefined}
      onClick={
        onSelectChrome
          ? (event) => {
              const inner = (event.target as HTMLElement).closest("[data-preview-chrome]");
              if (inner && inner !== event.currentTarget) return;
              (onSelectChrome as (c: Chrome) => void)("footer");
            }
          : undefined
      }
    >
      {onSelectChrome ? (
        <button
          type="button"
          className="sr-only"
          aria-pressed={selectedChrome === "footer"}
          onClick={(event) => {
            event.stopPropagation();
            (onSelectChrome as (c: Chrome) => void)("footer");
          }}
        >
          {t("footer")}
        </button>
      ) : null}
      <div className={cn(storeContainerClassName, designed ? pad : "py-10 md:py-12")}>{body}</div>
      {kind === "minimal" ? null : bottomBar}
    </footer>
  );
}

function FooterCol({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-bold text-store-footer-foreground">{title}</h2>
      <div className="mt-4 space-y-2.5 text-sm">{children}</div>
    </div>
  );
}

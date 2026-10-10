import { sanitizeLogoUrl } from './presentation/urls';

/**
 * CUST-HV V7a — `header.design.logo.size`. The preview frame simulates a viewport instead of
 * having one, so the storefront's `md:` pairs are resolved here from `mobile` rather than from
 * the editor window's own width.
 */
const SCALE = {
  sm: { mobile: 'h-6', desktop: 'h-7', wordMobile: 'text-lg', wordDesktop: 'text-xl', cap: 'max-w-[7rem]' },
  md: { mobile: 'h-8', desktop: 'h-9', wordMobile: 'text-xl', wordDesktop: 'text-2xl', cap: 'max-w-[9rem]' },
  lg: { mobile: 'h-10', desktop: 'h-12', wordMobile: 'text-2xl', wordDesktop: 'text-3xl', cap: 'max-w-[11rem]' },
  xl: { mobile: 'h-12', desktop: 'h-16', wordMobile: 'text-3xl', wordDesktop: 'text-4xl', cap: 'max-w-[14rem]' },
} as const;

export function StoreBrand({
  href,
  name,
  className,
  size = 'sm',
  tone = 'default',
  logoUrl,
  linked = true,
  scale,
  mobile = false,
  headerBrand = false,
}: {
  href: string;
  name: string;
  className?: string;
  size?: 'sm' | 'md';
  tone?: 'default' | 'dark';
  logoUrl?: string | null;
  /** Editor chrome selects the brand; it must not nest a link inside a button. */
  linked?: boolean;
  /** Merchant logo size (`header.design.logo.size`); absent ⇒ the `size` preset. */
  scale?: 'sm' | 'md' | 'lg' | 'xl';
  /** Which half of a scale's `md:` pair to use. */
  mobile?: boolean;
  /** V7b — marks the header brand so a chosen header text colour reaches the wordmark. */
  headerBrand?: boolean;
}) {
  const safeLogo = sanitizeLogoUrl(logoUrl ?? null);
  const color = tone === 'dark' ? 'text-store-footer-foreground' : 'text-store-primary';
  const classNameForBrand = `inline-flex min-w-0 max-w-full items-center ${color} ${className ?? ''}`;
  const picked = scale ? SCALE[scale] : null;
  const imgClass = picked
    ? `w-auto ${picked.cap} object-contain ${mobile ? picked.mobile : picked.desktop}`
    : `w-auto max-w-[9rem] object-contain ${size === 'md' ? 'h-8 md:h-9' : 'h-7'}`;
  const wordClass = picked
    ? mobile
      ? picked.wordMobile
      : picked.wordDesktop
    : size === 'md'
      ? 'text-xl md:text-2xl'
      : 'text-lg';
  const inner = safeLogo ? (
    <img
      src={safeLogo}
      alt={name}
      className={imgClass}
    />
  ) : (
    <span className={`min-w-0 truncate font-extrabold leading-none ${wordClass}`}>
      <bdi>{name}</bdi>
    </span>
  );
  const marker = headerBrand ? { 'data-header-brand': '' } : {};
  if (!linked) return <span className={classNameForBrand} {...marker}>{inner}</span>;
  return (
    <a href={href} className={classNameForBrand} {...marker}>
      {inner}
    </a>
  );
}

export const storeContainerClassName = 'mx-auto w-full max-w-store px-4 sm:px-6 lg:px-8';

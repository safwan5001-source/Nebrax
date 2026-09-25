import { sanitizeLogoUrl } from './presentation/urls';

export function StoreBrand({
  href,
  name,
  className,
  size = 'sm',
  tone = 'default',
  logoUrl,
  linked = true,
}: {
  href: string;
  name: string;
  className?: string;
  size?: 'sm' | 'md';
  tone?: 'default' | 'dark';
  logoUrl?: string | null;
  /** Editor chrome selects the brand; it must not nest a link inside a button. */
  linked?: boolean;
}) {
  const safeLogo = sanitizeLogoUrl(logoUrl ?? null);
  const color = tone === 'dark' ? 'text-store-footer-foreground' : 'text-store-primary';
  const classNameForBrand = `inline-flex min-w-0 max-w-full items-center ${color} ${className ?? ''}`;
  const inner = safeLogo ? (
    <img
      src={safeLogo}
      alt={name}
      className={`w-auto max-w-[9rem] object-contain ${size === 'md' ? 'h-8 md:h-9' : 'h-7'}`}
    />
  ) : (
    <span className={`min-w-0 truncate font-extrabold leading-none ${size === 'md' ? 'text-xl md:text-2xl' : 'text-lg'}`}>
      <bdi>{name}</bdi>
    </span>
  );
  if (!linked) return <span className={classNameForBrand}>{inner}</span>;
  return (
    <a href={href} className={classNameForBrand}>
      {inner}
    </a>
  );
}

export const storeContainerClassName = 'mx-auto w-full max-w-store px-4 sm:px-6 lg:px-8';

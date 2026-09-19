import { sanitizeLogoUrl } from './presentation/urls';

export function StoreBrand({
  href,
  name,
  className,
  size = 'sm',
  tone = 'default',
  logoUrl,
}: {
  href: string;
  name: string;
  className?: string;
  size?: 'sm' | 'md';
  tone?: 'default' | 'dark';
  logoUrl?: string | null;
}) {
  const safeLogo = sanitizeLogoUrl(logoUrl ?? null);
  const color = tone === 'dark' ? 'text-store-footer-foreground' : 'text-store-primary';
  return (
    <a href={href} className={`inline-flex min-w-0 max-w-full items-center ${color} ${className ?? ''}`}>
      {safeLogo ? (
        <img
          src={safeLogo}
          alt={name}
          className={`w-auto max-w-[9rem] object-contain ${size === 'md' ? 'h-8 md:h-9' : 'h-7'}`}
        />
      ) : (
        <span className={`min-w-0 truncate font-extrabold leading-none ${size === 'md' ? 'text-xl md:text-2xl' : 'text-lg'}`}>
          <bdi>{name}</bdi>
        </span>
      )}
    </a>
  );
}

export const storeContainerClassName = 'mx-auto w-full max-w-store px-4 sm:px-6 lg:px-8';

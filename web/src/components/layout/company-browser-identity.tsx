'use client';

import { useEffect } from 'react';
import { useCompany } from '@/lib/company';

const FALLBACK_ICON = '/icon.ico';
const SAFE_COMPANY_LOGO = /^(https:\/\/[^\s]+|data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/]+=*)$/i;
const OWNED_ATTRIBUTE = 'data-nebrax-company-icon';

export function safeCompanyIconUrl(value: string | null | undefined): string {
  const candidate = value?.trim() ?? '';
  return SAFE_COMPANY_LOGO.test(candidate) ? candidate : FALLBACK_ICON;
}

function updateLink(rel: string, href: string): void {
  const existing = Array.from(document.head.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`));
  const link = existing[0] ?? document.createElement('link');
  link.rel = rel;
  link.href = href;
  link.setAttribute(OWNED_ATTRIBUTE, 'true');
  if (!link.parentElement) document.head.appendChild(link);

  for (const duplicate of existing.slice(1)) duplicate.remove();
}

export function CompanyBrowserIdentity() {
  const company = useCompany();

  useEffect(() => {
    const href = safeCompanyIconUrl(company?.logo);
    updateLink('icon', href);
    updateLink('apple-touch-icon', href);
  }, [company?.logo]);

  return null;
}

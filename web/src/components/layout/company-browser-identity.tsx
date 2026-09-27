'use client';

import { useEffect, useState } from 'react';
import { useCompany } from '@/lib/company';
import { AUTH_SESSION_CHANGED_EVENT, isAuthenticated } from '@/lib/auth';

const FALLBACK_ICON = '/icon.ico';
const SAFE_COMPANY_LOGO = /^(https:\/\/[^\s]+|data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/]+=*)$/i;
const OWNED_ATTRIBUTE = 'data-nebrax-company-icon';
const OWNED_LINK_SELECTOR = `link[${OWNED_ATTRIBUTE}="true"]`;

export function safeCompanyIconUrl(value: string | null | undefined): string {
  const candidate = value?.trim() ?? '';
  return SAFE_COMPANY_LOGO.test(candidate) ? candidate : FALLBACK_ICON;
}

function updateLink(rel: string, href: string): void {
  const existing = Array.from(document.head.querySelectorAll<HTMLLinkElement>(`link[rel="${rel}"]`));
  const link = existing.find((candidate) => candidate.getAttribute(OWNED_ATTRIBUTE) === 'true')
    ?? document.createElement('link');
  link.rel = rel;
  link.href = href;
  link.setAttribute(OWNED_ATTRIBUTE, 'true');
  if (!link.parentElement) document.head.appendChild(link);

  for (const duplicate of existing) {
    if (duplicate !== link && duplicate.getAttribute(OWNED_ATTRIBUTE) === 'true') duplicate.remove();
  }
}

function removeOwnedLinks(): void {
  document.head.querySelectorAll<HTMLLinkElement>(OWNED_LINK_SELECTOR).forEach((link) => link.remove());
}

export function CompanyBrowserIdentity() {
  const company = useCompany();

  useEffect(() => {
    const href = safeCompanyIconUrl(company?.logo);
    updateLink('icon', href);
    updateLink('apple-touch-icon', href);
    return removeOwnedLinks;
  }, [company?.logo]);

  return null;
}

/** Boundary واحد لكل القشور المصادق عليها؛ لا يُركّب على المسارات العامة. */
export function AuthenticatedCompanyBrowserIdentity() {
  const [authenticated, setAuthenticated] = useState(() => isAuthenticated());

  useEffect(() => {
    const handleSessionChange = () => setAuthenticated(isAuthenticated());
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, handleSessionChange);
    return () => window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, handleSessionChange);
  }, []);

  return authenticated ? <CompanyBrowserIdentity /> : null;
}

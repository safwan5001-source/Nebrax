'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { LangToggle } from '@/components/layout/lang-toggle';
import { AwjLogo } from '@/components/layout/awj-logo';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { AuthBrandPanel, type AuthExperience } from './auth-brand-panel';
import './auth-experience.css';

interface AuthShellProps {
  children: ReactNode;
  /**
   * The customer auth experience (V2): a split screen with the AWJ brand panel on desktop and a navy
   * band above a lifted card on mobile. Without it the shell renders exactly as before; the internal
   * platform console login relies on that and is out of scope for the customer redesign.
   */
  experience?: AuthExperience;
}

export function AuthShell({ children, experience }: AuthShellProps) {
  const landing = useTranslations('landing');

  if (!experience) {
    return (
      <main className="relative min-h-screen bg-background px-4 pb-8 pt-16 sm:flex sm:items-center sm:justify-center sm:p-8">
        <div className="absolute end-4 top-4 flex items-center gap-1">
          <LangToggle />
          <ThemeToggle />
        </div>

        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="mb-6 flex justify-center" aria-label={landing('brand_aria')}>
            <AwjLogo alt="" className="h-14 w-auto sm:h-16" priority />
          </Link>
          {children}
        </div>
      </main>
    );
  }

  return <AuthExperienceShell experience={experience}>{children}</AuthExperienceShell>;
}

function AuthExperienceShell({ children, experience }: { children: ReactNode; experience: AuthExperience }) {
  const landing = useTranslations('landing');
  const t = useTranslations('authExperience');
  const locale = useLocale();

  return (
    <div className="ax" data-experience={experience}>
      <main className="ax-main">
        <div className="ax-band" aria-hidden="true" />
        <header className="ax-top">
          <Link href="/" className="ax-top__brand" aria-label={landing('brand_aria')}>
            <AwjLogo alt="" className="ax-logo h-9 w-auto" priority />
          </Link>
          <div className="ax-top__tools">
            <LangToggle />
            <ThemeToggle />
          </div>
        </header>

        {/* Mobile only: the panel's message, condensed above the card. */}
        <div className="ax-intro" aria-hidden="true">
          <p className="ax-intro__title">{t(`${experience}_title`)}</p>
          <p className="ax-intro__lead">{t(`${experience}_lead_short`)}</p>
        </div>

        <div className="ax-body">{children}</div>

        <p className="ax-foot">
          © <bdi>{new Date().getFullYear()}</bdi> {t('footer')}
        </p>
      </main>

      <AuthBrandPanel experience={experience} locale={locale} />
    </div>
  );
}

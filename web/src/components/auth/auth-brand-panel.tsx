'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Building2, GitBranch, KeyRound, ListChecks, Mail, ScanLine, ShieldCheck, ShoppingBag, Truck, Users } from 'lucide-react';
import { landingShotSrc } from '@/components/landing/landing-shot';

export type AuthExperience = 'login' | 'register' | 'recovery';

/**
 * The brand side of the customer auth experience. Every point is something the product does today:
 * - login: the Landing V2 differentiators (POS control & audit, delivery hub, store + app builder);
 * - register: what `AuthController::register` provisions in its transaction (tenant + subdomain slug,
 *   Saudi chart of accounts with main cash/bank, main branch and warehouse, the four system roles);
 * - recovery: where recovery and confirmation links are sent.
 * No counts, testimonials, pricing or trial promises.
 */
const POINTS: Record<AuthExperience, { key: string; Icon: typeof ScanLine }[]> = {
  login: [
    { key: 'login_point_pos', Icon: ScanLine },
    { key: 'login_point_delivery', Icon: Truck },
    { key: 'login_point_store', Icon: ShoppingBag },
  ],
  register: [
    { key: 'register_point_address', Icon: Building2 },
    { key: 'register_point_ledger', Icon: ListChecks },
    { key: 'register_point_branch', Icon: GitBranch },
    { key: 'register_point_roles', Icon: Users },
  ],
  recovery: [
    { key: 'recovery_point_email', Icon: Mail },
    { key: 'recovery_point_reset', Icon: KeyRound },
    { key: 'recovery_point_session', Icon: ShieldCheck },
  ],
};

// Real capture of the dashboard in preview mode (scripts/capture-landing-v2-shots.mjs), one per theme.
const GLIMPSE_SIZE = [2000, 1250] as const;

export function AuthBrandPanel({ experience, locale }: { experience: AuthExperience; locale: string }) {
  const t = useTranslations('authExperience');

  return (
    <aside className="ax-panel" aria-label={t('panel_aria')}>
      <div className="ax-panel__aurora" aria-hidden="true" />
      <div className="ax-panel__inner">
        <p className="ax-chip">
          <span className="ax-chip__dot" aria-hidden="true" />
          {t('eyebrow')}
        </p>
        <h2 className="ax-panel__title">{t(`${experience}_title`)}</h2>
        <p className="ax-panel__lead">{t(`${experience}_lead`)}</p>
        <ul className="ax-points">
          {POINTS[experience].map(({ key, Icon }) => (
            <li key={key}>
              <span className="ax-points__icon" aria-hidden="true">
                <Icon size={18} strokeWidth={1.8} />
              </span>
              {t(key)}
            </li>
          ))}
        </ul>
      </div>

      <figure className="ax-glimpse" aria-hidden="true">
        <div className="ax-glimpse__frame">
          <div className="ax-glimpse__bar">
            <span />
            <span />
            <span />
          </div>
          {(['light', 'dark'] as const).map((theme) => (
            <Image
              key={theme}
              src={landingShotSrc('app-dashboard', theme, locale)}
              width={GLIMPSE_SIZE[0]}
              height={GLIMPSE_SIZE[1]}
              alt=""
              sizes="(min-width: 1440px) 720px, 48vw"
              loading="lazy"
              className={`ax-glimpse__img ax-theme-${theme}`}
            />
          ))}
        </div>
      </figure>
    </aside>
  );
}

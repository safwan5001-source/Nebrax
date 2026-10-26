import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { AwjLogo } from '@/components/layout/awj-logo';
import { LangToggle } from '@/components/layout/lang-toggle';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { LandingNav } from '@/components/landing/landing-nav';
import { LandingTheme } from '@/components/landing/landing-theme';
import { LANDING_THEME_PRE_PAINT_SCRIPT } from '@/components/landing/landing-theme-script';
import { LandingShot, type LandingShotName } from '@/components/landing/landing-shot';
import { ModuleTabs, type ModuleTab } from '@/components/landing/module-tabs';
import './landing.css';

/**
 * اتجاه التصميم: «دفتر مفتوح» — الصفحة تعرض الدليل الذي لا يملكه إلا نظام قيد مزدوج: فاتورة حقيقية
 * وقيدها المرحَّل جنباً إلى جنب، ثم وحدات المنتج بلقطاتها، وحالة ما اكتمل وما لم يكتمل بوضوح.
 * كل اللقطات من المنتج نفسه في وضع المعاينة ببيانات تجريبية؛ لا أرقام استخدام ولا عملاء ولا شهادات.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('landing');
  return { description: t('meta_description') };
}

// نقطة البيع أولاً: لقطة المبيعات تكرّر قائمة الفواتير المعروضة في قسم التدفق قبلها مباشرة.
const MODULES: { id: string; shot: LandingShotName; prefix: string }[] = [
  { id: 'pos', shot: 'mod-pos', prefix: 'm_pos' },
  { id: 'sales', shot: 'mod-sales', prefix: 'm_sales' },
  { id: 'purchases', shot: 'mod-purchases', prefix: 'm_purchases' },
  { id: 'books', shot: 'mod-books', prefix: 'm_books' },
  { id: 'reports', shot: 'mod-reports', prefix: 'm_reports' },
];

const STATUS_ROWS: { key: 'sales' | 'stock' | 'books' | 'zatca' | 'hr' | 'ops'; state: 'ready' | 'partial' | 'building' }[] = [
  { key: 'sales', state: 'ready' },
  { key: 'stock', state: 'ready' },
  { key: 'books', state: 'ready' },
  { key: 'zatca', state: 'partial' },
  { key: 'hr', state: 'ready' },
  { key: 'ops', state: 'building' },
];

const CONTROLS = ['isolation', 'roles', 'immutable', 'money'] as const;

export default async function LandingPage() {
  const t = await getTranslations('landing');
  const locale = await getLocale();

  const tabs: ModuleTab[] = MODULES.map(({ id, shot, prefix }) => ({
    id,
    shot,
    label: t(`${prefix}_tab`),
    title: t(`${prefix}_title`),
    facts: [t(`${prefix}_1`), t(`${prefix}_2`), t(`${prefix}_3`)],
    alt: t(`${prefix}_alt`),
  }));

  return (
    <div className="lp">
      {/* AWJ Core on the public page only: the shared theme attributes before first paint (see landing-theme-script.ts). */}
      <script dangerouslySetInnerHTML={{ __html: LANDING_THEME_PRE_PAINT_SCRIPT }} />
      <LandingTheme />
      <a href="#main-content" className="lp-skip">
        {t('skip_to_content')}
      </a>

      <LandingNav
        brand={<AwjLogo className="h-10 w-auto" priority />}
        tools={
          <>
            <LangToggle />
            <ThemeToggle />
          </>
        }
        links={[
          { href: '#flow', label: t('nav_product') },
          { href: '#modules', label: t('nav_modules') },
          { href: '#status', label: t('nav_status') },
        ]}
        brandLabel={t('brand_aria')}
        navLabel={t('nav_aria')}
        menuLabel={t('nav_menu')}
        loginHref="/login"
        loginLabel={t('cta_login')}
        registerHref="/register"
        registerLabel={t('cta_register')}
      />

      <main id="main-content" tabIndex={-1} className="outline-none">
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-container lp-hero__grid">
            <div className="lp-hero__text">
              <h1 id="hero-title">{t('hero_title')}</h1>
              <p className="lp-hero__lead">{t('hero_subtitle')}</p>
              <div className="lp-hero__actions">
                <Link href="/register" className="lp-btn">
                  {t('cta_register')}
                </Link>
                <p className="lp-hero__have">
                  {t('hero_have_account')} <Link href="/login">{t('cta_login')}</Link>
                </p>
              </div>
            </div>
            <figure className="lp-shot lp-hero__shot" aria-label={t('hero_figure_aria')}>
              <LandingShot
                name="hero-entry"
                view="wide"
                locale={locale}
                alt={t('hero_desktop_alt')}
                sizes="(min-width: 1440px) 794px, (min-width: 960px) 56vw, 100vw"
                priority
              />
              <LandingShot name="phone-entry" view="narrow" eager locale={locale} alt={t('hero_mobile_alt')} sizes="384px" />
              <figcaption>{t('hero_caption')}</figcaption>
            </figure>
          </div>
        </section>

        <section id="flow" className="lp-section lp-section--tall" aria-labelledby="flow-title">
          <div className="lp-container">
            <div className="lp-head">
              <h2 id="flow-title">{t('flow_title')}</h2>
              <div className="lp-head__side">
                <p>{t('flow_lead_a')}</p>
                <p>{t('flow_lead_b')}</p>
              </div>
            </div>
            <div className="lp-flow">
              <div className="lp-flow__pair">
                <figure className="lp-shot">
                  <div className="lp-strip">
                    <LandingShot
                      name="strip-invoice"
                      view="wide"
                      locale={locale}
                      alt={t('flow_invoice_alt')}
                      sizes="(min-width: 1440px) 1312px, 100vw"
                    />
                    <span className="lp-mark lp-mark--invoice" aria-hidden="true" />
                  </div>
                  <LandingShot name="card-invoice" view="narrow" locale={locale} alt={t('flow_invoice_alt')} sizes="384px" />
                  <figcaption>{t('flow_invoice_caption')}</figcaption>
                </figure>
                <figure className="lp-shot">
                  <div className="lp-strip">
                    <LandingShot
                      name="strip-entry"
                      view="wide"
                      locale={locale}
                      alt={t('flow_entry_alt')}
                      sizes="(min-width: 1440px) 1312px, 100vw"
                    />
                    <span className="lp-mark lp-mark--entry" aria-hidden="true" />
                  </div>
                  <LandingShot name="card-entry" view="narrow" locale={locale} alt={t('flow_entry_alt')} sizes="384px" />
                  <figcaption>{t('flow_entry_caption')}</figcaption>
                </figure>
              </div>
            </div>
          </div>
        </section>

        <section id="modules" className="lp-section--band" aria-labelledby="modules-title">
          <div className="lp-container">
            <div className="lp-head">
              <h2 id="modules-title">{t('modules_title')}</h2>
            </div>
            <ModuleTabs tabs={tabs} tablistLabel={t('modules_tablist')} panHint={t('modules_pan_hint')} locale={locale} />
          </div>
        </section>

        <section className="lp-section" aria-labelledby="mobile-title">
          <div className="lp-container lp-mobile">
            <div className="lp-mobile__text">
              <h2 id="mobile-title">{t('mobile_title')}</h2>
              <p>{t('mobile_lead')}</p>
            </div>
            <div className="lp-mobile__shots">
              <figure className="lp-shot">
                <LandingShot
                  name="phone-dashboard"
                  locale={locale}
                  alt={t('mobile_dashboard_alt')}
                  sizes="(min-width: 960px) 24vw, 70vw"
                />
              </figure>
              <div className="lp-mobile__stack">
                <figure className="lp-shot">
                  <LandingShot name="card-purchase-a" locale={locale} alt={t('mobile_purchase_a_alt')} sizes="(min-width: 960px) 24vw, 70vw" />
                </figure>
                <figure className="lp-shot">
                  <LandingShot name="card-purchase-b" locale={locale} alt={t('mobile_purchase_b_alt')} sizes="(min-width: 960px) 24vw, 70vw" />
                </figure>
              </div>
            </div>
          </div>
        </section>

        <section id="status" className="lp-section--band" aria-labelledby="status-title">
          <div className="lp-container">
            <div className="lp-head lp-head--stack">
              <h2 id="status-title">{t('status_title')}</h2>
              <div className="lp-head__side">
                <p>{t('status_lead')}</p>
              </div>
            </div>
            <table className="lp-table">
              <thead>
                <tr>
                  <th scope="col">{t('status_col_module')}</th>
                  <th scope="col">{t('status_col_state')}</th>
                  <th scope="col">{t('status_col_detail')}</th>
                </tr>
              </thead>
              <tbody>
                {STATUS_ROWS.map(({ key, state }) => (
                  <tr key={key}>
                    <td>{t(`status_row_${key}_module`)}</td>
                    <td className={`lp-state--${state}`}>{t(`state_${state}`)}</td>
                    <td>{t(`status_row_${key}_detail`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="lp-status__action">
              <Link href="/register" className="lp-btn">
                {t('cta_register')}
              </Link>
            </div>
          </div>
        </section>

        <section className="lp-section lp-section--tall" aria-labelledby="security-title">
          <div className="lp-container lp-controls">
            <div>
              <h2 id="security-title">{t('security_title')}</h2>
              <p className="lp-note">{t('security_note')}</p>
            </div>
            <ul className="lp-controls__list">
              {CONTROLS.map((key) => (
                <li key={key} className="lp-control">
                  <h3>{t(`security_${key}_title`)}</h3>
                  <p>{t(`security_${key}_desc`)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="lp-section" aria-labelledby="close-title">
          <div className="lp-container">
            <div className="lp-close bg-primary px-6 py-10 text-primary-foreground sm:px-10 sm:py-14 lg:px-16 lg:py-20">
              <div className="lp-close__text">
                <h2 id="close-title">{t('close_title')}</h2>
                <p>{t('close_lead')}</p>
                <div className="lp-close__actions">
                  <Link href="/register" className="lp-btn lp-btn--inverse">
                    {t('cta_register')}
                  </Link>
                  <Link href="/login" className="lp-link">
                    {t('cta_login')}
                  </Link>
                </div>
              </div>
              <div className="lp-shot lp-close__proof" aria-hidden="true">
                <LandingShot name="card-entry" locale={locale} alt="" sizes="(min-width: 960px) 40vw, 100vw" />
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer__grid">
          <Link href="/" aria-label={t('brand_aria')} className="lp-nav__brand">
            <AwjLogo className="h-10 w-auto" />
          </Link>
          <nav aria-label={t('footer_nav')}>
            <Link href="/login">{t('cta_login')}</Link>
            <Link href="/register">{t('cta_register')}</Link>
            <a href="#modules">{t('nav_modules')}</a>
            <a href="#status">{t('nav_status')}</a>
          </nav>
          <p className="lp-footer__line">{t('footer_line')}</p>
        </div>
      </footer>
    </div>
  );
}

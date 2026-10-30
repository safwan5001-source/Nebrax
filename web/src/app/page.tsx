import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Cloud,
  Fuel,
  GitBranch,
  Languages,
  Layers,
  ListChecks,
  ScanLine,
  ShieldCheck,
  ShoppingCart,
  Store,
  Truck,
  Wrench,
} from 'lucide-react';
import { AwjLogo } from '@/components/layout/awj-logo';
import { LangToggle } from '@/components/layout/lang-toggle';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { BRAND } from '@/lib/brand';
import { BrandShowcase, type BrandShowcaseCopy } from '@/components/landing/brand-showcase';
import { DeliveryBoard } from '@/components/landing/delivery-board';
import { LandingMotion } from '@/components/landing/landing-motion';
import { LandingNav } from '@/components/landing/landing-nav';
import { LandingShot, type LandingShotName } from '@/components/landing/landing-shot';
import { LandingTheme } from '@/components/landing/landing-theme';
import { LANDING_THEME_PRE_PAINT_SCRIPT } from '@/components/landing/landing-theme-script';
import { ModuleTabs, type ModuleTab } from '@/components/landing/module-tabs';
import { PlatformOrbit } from '@/components/landing/platform-orbit';
import { PosAuditSignals, type SignalGroup } from '@/components/landing/pos-audit-signals';
import './landing.css';

/**
 * أَوْج — صفحة الهبوط V2 «منصة واحدة».
 * المزايا التنافسية أولاً (رقابة نقاط البيع، قنوات التوصيل، المتجر والتطبيق)، ثم عمق الـERP.
 * اللقطات من المنتج في وضع المعاينة (`scripts/capture-landing-v2-shots.mjs`)، والتمثيلات المرسومة
 * تستعمل تسميات الشاشات الفعلية من كتالوجاتها (`posAudit`، `deliveryHub`). ما لم يُبنَ بعد يحمل «قريبًا»
 * صراحةً؛ لا أرقام عملاء ولا شهادات ولا تكاملات غير قائمة — مصفوفة الأدلة في AWJ_LANDING_V2_IMPLEMENTATION_REPORT.md.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('landing');
  const locale = await getLocale();
  return {
    title: t('meta_title'),
    description: t('meta_description'),
    openGraph: {
      type: 'website',
      title: t('meta_title'),
      description: t('meta_description'),
      locale: locale === 'en' ? 'en_US' : 'ar_SA',
    },
    twitter: { card: 'summary', title: t('meta_title'), description: t('meta_description') },
  };
}

const ORBIT = ['finance', 'sales', 'purchases', 'inventory', 'pos', 'delivery', 'store', 'hr'] as const;

/** قواعد رصد حقيقية من كتالوج `posAudit.rules` (rule-labels.ts) لكل فئة معروضة. */
const SIGNAL_GROUPS = [
  { id: 'discounts', rules: ['discount_activity_rate', 'price_override_rate', 'cart_cancellation_rate'] },
  { id: 'returns', rules: ['refund_shortly_after_sale', 'cross_cashier_refund', 'refund_amount_rate'] },
  { id: 'drawer', rules: ['closing_variance_frequency', 'closing_variance_magnitude', 'manual_drawer_open_rate'] },
  { id: 'approvals', rules: ['performer_approver_pair_concentration', 'override_approval_rate', 'outside_operating_hours'] },
] as const;

const REVIEW_STATES = ['new', 'reviewing', 'explained', 'dismissed', 'needs_investigation'] as const;
const DELIVERY_STATES = ['state_received', 'state_accepted', 'state_preparing', 'state_ready', 'state_handed_off'] as const;

// نقطة البيع أولاً: لقطة المبيعات تكرّر قائمة الفواتير، فتأتي بعدها.
const MODULES: { id: string; shot: LandingShotName; prefix: string }[] = [
  { id: 'pos', shot: 'mod-pos', prefix: 'm_pos' },
  { id: 'sales', shot: 'mod-sales', prefix: 'm_sales' },
  { id: 'purchases', shot: 'mod-purchases', prefix: 'm_purchases' },
  { id: 'books', shot: 'mod-books', prefix: 'm_books' },
  { id: 'reports', shot: 'mod-reports', prefix: 'm_reports' },
];

const ERP_INDEX = ['finance', 'sales', 'purchases', 'inventory', 'pos', 'reports', 'hr', 'branches', 'roles', 'vat'] as const;
const FUEL_NOW = [1, 2, 3, 4, 5] as const;
const FUEL_SOON = [1, 2, 3] as const;
const JOURNEYS = ['j1', 'j2', 'j3'] as const;
const WHY = [
  { key: 'arabic', Icon: Languages },
  { key: 'cloud', Icon: Cloud },
  { key: 'ledger', Icon: ListChecks },
  { key: 'roles', Icon: ShieldCheck },
  { key: 'branches', Icon: GitBranch },
  { key: 'clarity', Icon: Layers },
] as const;
const WHO = [
  { key: 'retail', Icon: Store },
  { key: 'distribution', Icon: Truck },
  { key: 'services', Icon: Wrench },
  { key: 'branches', Icon: Building2 },
  { key: 'commerce', Icon: ShoppingCart },
  { key: 'fuel', Icon: Fuel },
] as const;
const FAQ = [1, 2, 3, 4, 5, 6, 7] as const;

export default async function LandingPage() {
  const t = await getTranslations('landing');
  const audit = await getTranslations('posAudit');
  const hub = await getTranslations('deliveryHub');
  const locale = await getLocale();
  const Forward = locale === 'en' ? ArrowRight : ArrowLeft;

  const tabs: ModuleTab[] = MODULES.map(({ id, shot, prefix }) => ({
    id,
    shot,
    label: t(`${prefix}_tab`),
    title: t(`${prefix}_title`),
    facts: [t(`${prefix}_1`), t(`${prefix}_2`), t(`${prefix}_3`)],
    alt: t(`${prefix}_alt`),
  }));

  const signalGroups: SignalGroup[] = SIGNAL_GROUPS.map(({ id, rules }) => ({
    id,
    label: t(`pos_g_${id}`),
    description: t(`pos_g_${id}_desc`),
    rules: rules.map((rule) => audit(`rules.${rule}`)),
  }));

  const deliveryStates = DELIVERY_STATES.map((key) => hub(key));

  const showcase: BrandShowcaseCopy = {
    swatchLabel: t('swatch_label'),
    swatches: (['blue', 'emerald', 'plum', 'amber'] as const).map((id) => ({ id, label: t(`swatch_${id}`) })),
    storeAria: t('store_aria'),
    appAria: t('app_aria'),
    storeName: t('store_name'),
    storeSearch: t('store_search'),
    heroTitle: t('store_hero_title'),
    heroCta: t('store_hero_cta'),
    benefits: [t('store_benefit_1'), t('store_benefit_2'), t('store_benefit_3')],
    featured: t('store_featured'),
    products: [t('store_product_1'), t('store_product_2'), t('store_product_3')],
    add: t('store_add'),
    greeting: t('app_greeting'),
    tabs: [t('app_tab_home'), t('app_tab_categories'), t('app_tab_cart'), t('app_tab_account')],
  };

  const soonBadge = <span className="lp-badge lp-badge--soon">{t('badge_soon')}</span>;

  return (
    <div className="lp">
      {/* AWJ Core on the public page only: the shared theme attributes before first paint (see landing-theme-script.ts). */}
      <script dangerouslySetInnerHTML={{ __html: LANDING_THEME_PRE_PAINT_SCRIPT }} />
      <LandingTheme />
      <LandingMotion />
      <a href="#main-content" className="lp-skip">
        {t('skip_to_content')}
      </a>

      <LandingNav
        brand={<AwjLogo className="lp-logo h-10 w-auto" priority />}
        tools={
          <>
            <LangToggle />
            <ThemeToggle />
          </>
        }
        links={[
          { href: '#features', label: t('nav_features') },
          { href: '#solutions', label: t('nav_solutions') },
          { href: '#commerce', label: t('nav_commerce') },
          { href: '#why', label: t('nav_why') },
        ]}
        brandLabel={t('brand_aria')}
        navLabel={t('nav_aria')}
        menuLabel={t('nav_menu')}
        closeLabel={t('nav_close')}
        loginHref="/login"
        loginLabel={t('cta_login')}
        registerHref="/register"
        registerLabel={t('cta_register')}
      />

      <main id="main-content" tabIndex={-1} className="outline-none">
        {/* 1 · Hero */}
        <section className="lp-hero lp-dark" aria-labelledby="hero-title">
          <div className="lp-hero__aurora" aria-hidden="true" />
          <div className="lp-container lp-hero__inner">
            <div className="lp-hero__copy">
              <p className="lp-chip">
                <span className="lp-chip__dot" aria-hidden="true" />
                {t('hero_eyebrow')}
              </p>
              <h1 id="hero-title">
                <span>{t('hero_title_a')}</span> <span className="lp-glow-text">{t('hero_title_b')}</span>
              </h1>
              <p className="lp-hero__lead">{t('hero_lead')}</p>
              <p className="lp-hero__support">{t('hero_support')}</p>
              <div className="lp-actions">
                <Link href="/register" className="lp-btn lp-btn--lg">
                  {t('cta_register')}
                  <Forward aria-hidden="true" size={18} strokeWidth={2} />
                </Link>
                <a href="#features" className="lp-btn lp-btn--lg lp-btn--glass">
                  {t('cta_explore')}
                </a>
              </div>
              <p className="lp-hero__have">
                {t('hero_have_account')} <Link href="/login">{t('cta_login')}</Link>
              </p>
            </div>

            <figure className="lp-hero__stage" aria-label={t('hero_figure_aria')}>
              <div className="lp-window lp-hero__window">
                <div className="lp-window__bar" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <i />
                </div>
                <LandingShot
                  name="app-dashboard"
                  locale={locale}
                  alt={t('hero_dash_alt')}
                  sizes="(min-width: 1440px) 1180px, (min-width: 960px) 82vw, 94vw"
                  priority
                />
              </div>
              <div className="lp-phone lp-hero__phone">
                <div className="lp-phone__screen">
                  <LandingShot name="phone-dashboard" locale={locale} alt={t('hero_phone_alt')} sizes="(min-width: 960px) 240px, 38vw" eager />
                </div>
              </div>
              <div className="lp-float lp-float--review" aria-hidden="true">
                <span className="lp-float__icon">
                  <ScanLine size={16} strokeWidth={2} />
                </span>
                <span>
                  <small>{t('hero_float_review_label')}</small>
                  <b>
                    <bdi className="lp-num">6</bdi> {t('hero_float_review_value')}
                  </b>
                </span>
              </div>
              <div className="lp-float lp-float--entry" aria-hidden="true">
                <span className="lp-float__icon lp-float__icon--ok">
                  <ListChecks size={16} strokeWidth={2} />
                </span>
                <span>
                  <small>{t('hero_float_entry_label')}</small>
                  <b>{t('hero_float_entry_value')}</b>
                </span>
              </div>
              <figcaption className="lp-caption">{t('demo_note')}</figcaption>
            </figure>
          </div>
        </section>

        {/* 3 · Unified platform */}
        <section id="features" className="lp-sec" aria-labelledby="platform-title">
          <div className="lp-container lp-platform">
            <div className="lp-platform__copy" data-reveal="">
              <p className="lp-eyebrow">{t('platform_eyebrow')}</p>
              <h2 id="platform-title">{t('platform_title')}</h2>
              <p className="lp-lead">{t('platform_lead')}</p>
              <ol className="lp-beats">
                {[1, 2, 3].map((n) => (
                  <li key={n}>
                    <span className="lp-beats__n lp-num" aria-hidden="true">
                      0{n}
                    </span>
                    <h3>{t(`platform_beat_${n}_title`)}</h3>
                    <p>{t(`platform_beat_${n}_desc`)}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div data-reveal="">
              <PlatformOrbit
                core={<AwjLogo className="lp-logo h-9 w-auto" />}
                coreTitle={t('orbit_core_title')}
                coreSub={t('orbit_core_sub')}
                nodes={ORBIT.map((key) => t(`orbit_${key}`))}
                label={t('orbit_aria')}
              />
            </div>
          </div>
        </section>

        {/* 4 · POS control — signature */}
        <section id="pos-control" className="lp-sec lp-dark lp-dark--deep" aria-labelledby="pos-title">
          <div className="lp-container">
            <div className="lp-head lp-head--center" data-reveal="">
              <p className="lp-eyebrow lp-eyebrow--glow">{t('pos_eyebrow')}</p>
              <h2 id="pos-title" className="lp-display">
                {t('pos_title')}
              </h2>
              <p className="lp-lead">{t('pos_lead')}</p>
            </div>
            <div className="lp-pos">
              <figure className="lp-pos__stage" data-reveal="">
                <div className="lp-window lp-only-wide">
                  <div className="lp-window__bar" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <i />
                  </div>
                  <LandingShot
                    name="app-pos-audit"
                    view="wide"
                    locale={locale}
                    alt={t('pos_shot_alt')}
                    sizes="(min-width: 1440px) 760px, (min-width: 960px) 56vw, 94vw"
                  />
                </div>
                <div className="lp-phone lp-only-narrow">
                  <div className="lp-phone__screen">
                    <LandingShot name="phone-pos-audit" view="narrow" locale={locale} alt={t('pos_phone_alt')} sizes="72vw" />
                  </div>
                </div>
                <figcaption className="lp-caption">{t('demo_note')}</figcaption>
              </figure>

              <div className="lp-pos__aside">
                <div className="lp-panel-glass" data-reveal="">
                  <h3>{t('pos_groups_label')}</h3>
                  <PosAuditSignals groups={signalGroups} tablistLabel={t('pos_groups_label')} rulesLabel={t('pos_rules_label')} />
                </div>
                <div className="lp-panel-glass" data-reveal="">
                  <h3>{t('pos_review_title')}</h3>
                  <ol className="lp-flow-pills">
                    {REVIEW_STATES.map((state) => (
                      <li key={state} data-state={state}>
                        {audit(`states.${state}`)}
                      </li>
                    ))}
                  </ol>
                  <p className="lp-muted">{t('pos_review_desc')}</p>
                </div>
                <div className="lp-panel-glass" data-reveal="">
                  <h3>{t('pos_score_title')}</h3>
                  <p className="lp-muted">{t('pos_score_desc')}</p>
                  <div className="lp-meter" aria-hidden="true">
                    <span>{audit('observedRate')}</span>
                    <i style={{ inlineSize: '72%' }} />
                    <span>{audit('baselineRate')}</span>
                    <i className="lp-meter__base" style={{ inlineSize: '38%' }} />
                  </div>
                </div>
                <p className="lp-note" data-reveal="">
                  <ShieldCheck aria-hidden="true" size={18} strokeWidth={1.8} />
                  {audit('notAccusation')}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 5 · Delivery hub */}
        <section id="delivery" className="lp-sec" aria-labelledby="delivery-title">
          <div className="lp-container lp-split">
            <div data-reveal="">
              <p className="lp-eyebrow">{t('delivery_eyebrow')}</p>
              <h2 id="delivery-title">{t('delivery_title')}</h2>
              <p className="lp-lead">{t('delivery_lead')}</p>
              <ul className="lp-points">
                {[1, 2, 3].map((n) => (
                  <li key={n}>
                    <h3>{t(`delivery_p${n}_title`)}</h3>
                    <p>{t(`delivery_p${n}_desc`)}</p>
                  </li>
                ))}
              </ul>
              <ul className="lp-soon-list">
                {[1, 2].map((n) => (
                  <li key={n}>
                    {soonBadge}
                    <span>{t(`delivery_soon_${n}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <figure className="lp-delivery__stage" data-reveal="">
              <DeliveryBoard
                label={t('board_aria')}
                title={hub('title')}
                subtitle={hub('subtitle')}
                all={hub('all')}
                referenceLabel={t('board_ref')}
                branchLabel={hub('branch')}
                states={deliveryStates}
                live={{ channel: t('board_channel_a'), reference: '48213', branch: t('board_branch_main') }}
                rows={[
                  { channel: t('board_channel_b'), reference: '77105-K', branch: t('board_branch_north'), state: deliveryStates[3] },
                  { channel: t('board_channel_a'), reference: '48197', branch: t('board_branch_main'), state: deliveryStates[4] },
                ]}
              />
              <figcaption className="lp-caption">{t('illustrative_note')}</figcaption>
            </figure>
          </div>
        </section>

        {/* 6 · Storefront + app */}
        <section id="commerce" className="lp-sec lp-dark lp-dark--aurora" aria-labelledby="commerce-title">
          <div className="lp-container">
            <div className="lp-head lp-head--center" data-reveal="">
              <p className="lp-eyebrow lp-eyebrow--glow">{t('commerce_eyebrow')}</p>
              <h2 id="commerce-title" className="lp-display">
                {t('commerce_title')}
              </h2>
              <p className="lp-lead">{t('commerce_lead')}</p>
            </div>
            <figure className="lp-commerce__stage" data-reveal="">
              <BrandShowcase copy={showcase} />
              <figcaption className="lp-caption">{t('illustrative_note')}</figcaption>
            </figure>
            <div className="lp-commerce__lists">
              <div className="lp-panel-glass" data-reveal="">
                <h3>
                  <span className="lp-badge lp-badge--now">{t('badge_now')}</span>
                  {t('commerce_now_title')}
                </h3>
                <ul className="lp-check-list">
                  {[1, 2, 3, 4].map((n) => (
                    <li key={n}>{t(`commerce_now_${n}`)}</li>
                  ))}
                </ul>
              </div>
              <div className="lp-panel-glass lp-panel-glass--quiet" data-reveal="">
                <h3>
                  {soonBadge}
                  {t('commerce_soon_title')}
                </h3>
                <ul className="lp-dot-list">
                  {[1, 2, 3].map((n) => (
                    <li key={n}>{t(`commerce_soon_${n}`)}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* 7 · ERP core */}
        <section id="erp" className="lp-sec" aria-labelledby="erp-title">
          <div className="lp-container">
            <div className="lp-head" data-reveal="">
              <div>
                <p className="lp-eyebrow">{t('erp_eyebrow')}</p>
                <h2 id="erp-title">{t('erp_title')}</h2>
              </div>
              <p className="lp-lead">{t('erp_lead')}</p>
            </div>
            <div data-reveal="">
              <ModuleTabs tabs={tabs} tablistLabel={t('modules_tablist')} panHint={t('modules_pan_hint')} locale={locale} />
            </div>
            <div className="lp-index" data-reveal="">
              <h3 className="lp-index__label">{t('erp_index_label')}</h3>
              <dl>
                {ERP_INDEX.map((key) => (
                  <div key={key}>
                    <dt>{t(`erp_i_${key}`)}</dt>
                    <dd>
                      {t(`erp_i_${key}_desc`)}
                      {key === 'vat' && (
                        <span className="lp-index__soon">
                          {soonBadge}
                          <span>{t('erp_i_vat_soon')}</span>
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* 8 · Specialized: fuel stations */}
        <section id="specialized" className="lp-sec lp-dark lp-dark--deep" aria-labelledby="fuel-title">
          <div className="lp-container lp-split lp-split--reverse">
            <div data-reveal="">
              <p className="lp-eyebrow lp-eyebrow--glow">{t('fuel_eyebrow')}</p>
              <h2 id="fuel-title">{t('fuel_title')}</h2>
              <p className="lp-lead">{t('fuel_lead')}</p>
              <p className="lp-badge lp-badge--outline">{t('fuel_badge')}</p>
              <ul className="lp-check-list">
                {FUEL_NOW.map((n) => (
                  <li key={n}>{t(`fuel_now_${n}`)}</li>
                ))}
              </ul>
              <ul className="lp-soon-list">
                {FUEL_SOON.map((n) => (
                  <li key={n}>
                    {soonBadge}
                    <span>{t(`fuel_soon_${n}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <figure className="lp-fuel__stage" data-reveal="">
              <div className="lp-window lp-only-wide">
                <div className="lp-window__bar" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <i />
                </div>
                <LandingShot
                  name="app-fuel"
                  view="wide"
                  locale={locale}
                  alt={t('fuel_shot_alt')}
                  sizes="(min-width: 1440px) 720px, (min-width: 960px) 52vw, 94vw"
                />
              </div>
              <div className="lp-phone lp-only-narrow">
                <div className="lp-phone__screen">
                  <LandingShot name="phone-fuel" view="narrow" locale={locale} alt={t('fuel_phone_alt')} sizes="72vw" />
                </div>
              </div>
              <figcaption className="lp-caption">{t('demo_note')}</figcaption>
            </figure>
          </div>
        </section>

        {/* 9 · Journeys */}
        <section id="journeys" className="lp-sec" aria-labelledby="journeys-title">
          <div className="lp-container">
            <div className="lp-head lp-head--center" data-reveal="">
              <p className="lp-eyebrow">{t('journeys_eyebrow')}</p>
              <h2 id="journeys-title">{t('journeys_title')}</h2>
            </div>
            <div className="lp-journeys">
              {JOURNEYS.map((journey) => (
                <article key={journey} className="lp-journey" data-reveal="">
                  <h3>{t(`${journey}_title`)}</h3>
                  <ol>
                    {[1, 2, 3, 4].map((n) => (
                      <li key={n}>{t(`${journey}_s${n}`)}</li>
                    ))}
                  </ol>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* 10 · Why AWJ */}
        <section id="why" className="lp-sec lp-dark" aria-labelledby="why-title">
          <div className="lp-container">
            <div className="lp-head" data-reveal="">
              <div>
                <p className="lp-eyebrow lp-eyebrow--glow">{t('why_eyebrow')}</p>
                <h2 id="why-title">{t('why_title')}</h2>
              </div>
            </div>
            <ul className="lp-why">
              {WHY.map(({ key, Icon }) => (
                <li key={key} data-reveal="">
                  <Icon aria-hidden="true" size={22} strokeWidth={1.6} />
                  <h3>{t(`why_${key}`)}</h3>
                  <p>{t(`why_${key}_desc`)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 11 · Who it's for */}
        <section id="solutions" className="lp-sec" aria-labelledby="who-title">
          <div className="lp-container">
            <div className="lp-head" data-reveal="">
              <div>
                <p className="lp-eyebrow">{t('who_eyebrow')}</p>
                <h2 id="who-title">{t('who_title')}</h2>
              </div>
            </div>
            <ul className="lp-who">
              {WHO.map(({ key, Icon }) => (
                <li key={key} data-reveal="">
                  <span className="lp-who__icon">
                    <Icon aria-hidden="true" size={20} strokeWidth={1.7} />
                  </span>
                  <h3>{t(`who_${key}`)}</h3>
                  <p>{t(`who_${key}_desc`)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 12 · FAQ */}
        <section id="faq" className="lp-sec lp-sec--tint" aria-labelledby="faq-title">
          <div className="lp-container lp-faq">
            <h2 id="faq-title" data-reveal="">
              {t('faq_title')}
            </h2>
            <div className="lp-faq__list">
              {FAQ.map((n) => (
                <details key={n} className="lp-faq__item">
                  <summary>{t(`faq_q${n}`)}</summary>
                  <p>{t(`faq_a${n}`)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* 13 · Close */}
        <section className="lp-close lp-dark lp-dark--aurora" aria-labelledby="close-title">
          <div className="lp-container lp-close__inner" data-reveal="">
            <h2 id="close-title" className="lp-display">
              {t('close_title')}
            </h2>
            <p className="lp-lead">{t('close_lead')}</p>
            <div className="lp-actions lp-actions--center">
              <Link href="/register" className="lp-btn lp-btn--lg">
                {t('cta_register')}
                <Forward aria-hidden="true" size={18} strokeWidth={2} />
              </Link>
              <Link href="/login" className="lp-btn lp-btn--lg lp-btn--glass">
                {t('cta_login')}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer lp-dark">
        <div className="lp-container lp-footer__grid">
          <div className="lp-footer__brand">
            <Link href="/" aria-label={t('brand_aria')} className="lp-nav__brand">
              <AwjLogo className="lp-logo h-10 w-auto" />
            </Link>
            <p>{t('footer_line')}</p>
          </div>
          <nav aria-label={t('footer_nav')} className="lp-footer__nav">
            <div>
              <h2>{t('footer_product')}</h2>
              <a href="#features">{t('nav_features')}</a>
              <a href="#solutions">{t('nav_solutions')}</a>
              <a href="#commerce">{t('nav_commerce')}</a>
              <a href="#why">{t('nav_why')}</a>
            </div>
            <div>
              <h2>{t('footer_account')}</h2>
              <Link href="/register">{t('cta_register')}</Link>
              <Link href="/login">{t('cta_login')}</Link>
            </div>
          </nav>
        </div>
        <div className="lp-container lp-footer__base">
          <p>
            © <bdi className="lp-num">{new Date().getFullYear()}</bdi> {BRAND.displayName}
          </p>
        </div>
      </footer>
    </div>
  );
}

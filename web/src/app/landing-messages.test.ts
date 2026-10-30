import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';

const root = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

type Catalog = Record<string, unknown>;
const landingAr = (ar as unknown as { landing: Record<string, string> }).landing;
const landingEn = (en as unknown as { landing: Record<string, string> }).landing;

function lookup(catalog: Catalog, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Catalog)[key] : undefined), catalog);
}

const PAGE_SOURCES = [
  'app/page.tsx',
  'components/landing/landing-nav.tsx',
  'components/landing/module-tabs.tsx',
  'components/landing/brand-showcase.tsx',
  'components/landing/delivery-board.tsx',
  'components/landing/platform-orbit.tsx',
  'components/landing/pos-audit-signals.tsx',
];

/** مفاتيح تُركَّب في الشيفرة (`${prefix}_title`…) فتُفحص هنا بقوائمها الصريحة، مطابقةً لثوابت `page.tsx`. */
const MODULE_PREFIXES = ['m_sales', 'm_pos', 'm_purchases', 'm_books', 'm_reports'];
const ORBIT = ['finance', 'sales', 'purchases', 'inventory', 'pos', 'delivery', 'store', 'hr'];
const SIGNALS = ['discounts', 'returns', 'drawer', 'approvals'];
const ERP_INDEX = ['finance', 'sales', 'purchases', 'inventory', 'pos', 'reports', 'hr', 'branches', 'roles', 'vat'];
const WHY = ['arabic', 'cloud', 'ledger', 'roles', 'branches', 'clarity'];
const WHO = ['retail', 'distribution', 'services', 'branches', 'commerce', 'fuel'];
const SWATCHES = ['blue', 'emerald', 'plum', 'amber'];

/** تسميات تقرؤها الصفحة من كتالوجات الشاشات الفعلية بدل نسخها. */
const PRODUCT_LABELS = [
  ...['discount_activity_rate', 'price_override_rate', 'cart_cancellation_rate', 'refund_shortly_after_sale', 'cross_cashier_refund', 'refund_amount_rate', 'closing_variance_frequency', 'closing_variance_magnitude', 'manual_drawer_open_rate', 'performer_approver_pair_concentration', 'override_approval_rate', 'outside_operating_hours'].map((rule) => `posAudit.rules.${rule}`),
  ...['new', 'reviewing', 'explained', 'dismissed', 'needs_investigation'].map((state) => `posAudit.states.${state}`),
  'posAudit.notAccusation',
  'posAudit.observedRate',
  'posAudit.baselineRate',
  ...['title', 'subtitle', 'all', 'branch', 'state_received', 'state_accepted', 'state_preparing', 'state_ready', 'state_handed_off'].map((key) => `deliveryHub.${key}`),
];

describe('landing page messages', () => {
  it('Arabic and English carry exactly the same keys', () => {
    expect(Object.keys(landingEn).sort()).toEqual(Object.keys(landingAr).sort());
  });

  it('every message is a non-empty string in both languages', () => {
    for (const catalog of [landingAr, landingEn]) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(typeof value, key).toBe('string');
        expect(value.trim().length, key).toBeGreaterThan(0);
      }
    }
  });

  it('every literal key the page and its components read exists', () => {
    const source = PAGE_SOURCES.map(read).join('\n');
    const literal = [...source.matchAll(/\bt\('([a-z0-9_]+)'\)/g)].map((match) => match[1]);
    expect(literal.length).toBeGreaterThan(60);
    for (const key of literal) {
      expect(landingAr, key).toHaveProperty(key);
      expect(landingEn, key).toHaveProperty(key);
    }
  });

  it('every composed key family exists', () => {
    const composed = [
      ...MODULE_PREFIXES.flatMap((prefix) => [`${prefix}_tab`, `${prefix}_title`, `${prefix}_1`, `${prefix}_2`, `${prefix}_3`, `${prefix}_alt`]),
      ...ORBIT.map((key) => `orbit_${key}`),
      ...SIGNALS.flatMap((key) => [`pos_g_${key}`, `pos_g_${key}_desc`]),
      ...[1, 2, 3].flatMap((n) => [`platform_beat_${n}_title`, `platform_beat_${n}_desc`, `delivery_p${n}_title`, `delivery_p${n}_desc`]),
      ...[1, 2].map((n) => `delivery_soon_${n}`),
      ...[1, 2, 3, 4].map((n) => `commerce_now_${n}`),
      ...[1, 2, 3].map((n) => `commerce_soon_${n}`),
      ...SWATCHES.map((key) => `swatch_${key}`),
      ...ERP_INDEX.flatMap((key) => [`erp_i_${key}`, `erp_i_${key}_desc`]),
      ...[1, 2, 3, 4, 5].map((n) => `fuel_now_${n}`),
      ...[1, 2, 3].map((n) => `fuel_soon_${n}`),
      ...['j1', 'j2', 'j3'].flatMap((j) => [`${j}_title`, ...[1, 2, 3, 4].map((n) => `${j}_s${n}`)]),
      ...WHY.flatMap((key) => [`why_${key}`, `why_${key}_desc`]),
      ...WHO.flatMap((key) => [`who_${key}`, `who_${key}_desc`]),
      ...[1, 2, 3, 4, 5, 6, 7].flatMap((n) => [`faq_q${n}`, `faq_a${n}`]),
    ];
    for (const key of composed) {
      expect(landingAr, key).toHaveProperty(key);
      expect(landingEn, key).toHaveProperty(key);
    }
  });

  it('reads the product labels it shows from the screens’ own catalogs, in both languages', () => {
    for (const path of PRODUCT_LABELS) {
      expect(typeof lookup(ar as unknown as Catalog, path), path).toBe('string');
      expect(typeof lookup(en as unknown as Catalog, path), path).toBe('string');
    }
  });

  it('keeps the brand key the auth shell reads', () => {
    expect(landingAr.brand_aria).toBeTruthy();
    expect(landingEn.brand_aria).toBeTruthy();
  });

  it('leads with the approved headline and differentiator', () => {
    expect(`${landingAr.hero_title_a} ${landingAr.hero_title_b}`).toBe('كل أعمالك. نظام واحد.');
    expect(landingAr.meta_title).toBe('أَوْج — كل أعمالك. نظام واحد.');
    expect(landingAr.hero_lead).toBe('أكثر من ERP: من المحاسبة والمبيعات إلى رقابة نقاط البيع والتجارة الإلكترونية وتطبيقات المتاجر.');
    expect(landingAr.cta_register).toBe('ابدأ الآن');
    expect(landingAr.cta_explore).toBe('استكشف المميزات');
    expect(landingAr.pos_title).toBe('نقاط بيع تحت سيطرتك');
    expect(landingAr.commerce_title).toBe('متجرك بهويتك، وتطبيق باسم علامتك');
  });

  it('makes none of the claims the product cannot back with evidence', () => {
    const all = [...Object.values(landingAr), ...Object.values(landingEn)].join('\n');
    expect(all, 'a sector count').not.toMatch(/\b60\b|٦٠/);
    expect(all, 'a tested-in-a-real-company claim').not.toMatch(/real company|شركة حقيقية/i);
    expect(all, 'a ZATCA compliance claim').not.toMatch(/المرحلتين|both phases|compliant|متوافق|certified/i);
    expect(all, 'a free-trial or pricing promise').not.toMatch(/free trial|تجربة مجانية|مجاناً|مجاني|per month|شهرياً|no credit card|بدون بطاقة/i);
    expect(all, 'an uptime or certification claim').not.toMatch(/uptime|SLA|ISO ?27001|SOC ?2|معتمد من|100 ?%/i);
    expect(all, 'an absolute security guarantee').not.toMatch(/آمن تماماً|unbreakable|bank-grade|fully secure/i);
  });

  it('names no delivery provider: none has a live connection today', () => {
    const all = [...Object.values(landingAr), ...Object.values(landingEn)].join('\n');
    expect(all).not.toMatch(/HungerStation|هنقرستيشن|Jahez|جاهز للتوصيل|Keeta|كيتا|Mrsool|مرسول|Ninja|نينجا|Chefz|شيفز|Careem|كريم/i);
  });

  it('only mentions store publishing, card payments and Fatoora submission as not yet available', () => {
    const later = new Set(['commerce_soon_1', 'commerce_soon_2', 'erp_i_vat_soon', 'faq_a4', 'faq_a5']);
    for (const catalog of [landingAr, landingEn]) {
      for (const [key, value] of Object.entries(catalog)) {
        if (later.has(key)) continue;
        expect(value, key).not.toMatch(/App Store|Google Play|Fatoora|منصة فاتورة|card payments|بالبطاقات/i);
      }
    }
    expect(landingEn.faq_a4).toMatch(/not switched on yet/);
    expect(landingEn.faq_a5).toMatch(/on the way/);
    expect(landingEn.faq_a6).toMatch(/^Not yet\./);
  });

  it('never prints the legacy currency text or an invented customer claim', () => {
    const all = [...Object.values(landingAr), ...Object.values(landingEn)].join('\n');
    expect(all).not.toMatch(/﷼|ر\.س|\bSAR\b/);
    expect(all).not.toMatch(/\b(trusted by|testimonial|customers love)\b|يثق بنا|عملاؤنا|آلاف العملاء/i);
  });
});

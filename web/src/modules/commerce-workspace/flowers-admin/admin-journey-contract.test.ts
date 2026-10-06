import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

import { loadVerticalSetup } from '@/modules/commerce-workspace/vertical-setup';
import { loadSchedule, saveBlockedDates, saveSettings, saveSlots } from './delivery-schedule';
import { saveFulfillment } from './fulfillment';
import { loadGiftPolicy, saveGiftPolicy } from './gift-settings';
import { saveAddons, type AddonRow } from './product/addons';
import { saveContent, type ContentBlock } from './product/content';
import { savePersonalization, type PersonalizationField } from './product/personalization';
import { savePreparation } from './product/preparation';

/**
 * FLOWERS-H2-15 — عقد رحلة التاجر الكاملة بين واجهة الإدارة والخادم الفعلي.
 *
 * `contracts/flowers-admin-journey/requests.json` يُولَّد **من هذا الاختبار** من طلبات العميل الفعلية (مسار + جسم كل حفظ)،
 * ويعيد `FlowersMerchantAdminJourneyTest` (PHP) تشغيلها كما هي على الـAPI الحقيقي ويلتقط الاستجابات في
 * `responses/*.json` ويقارنها بالعقد في كل تشغيل. وهنا تمرّ تلك الاستجابات الحقيقية عبر محلّلات الواجهة نفسها: ما
 * حفظه التاجر هو ما يعيده الخادم، وأي انحراف في الطلب أو الاستجابة يفشل في أحد الطرفين بدل أن يظهر عند التاجر.
 *
 * المعرّفات رموز ثابتة (STORE/PRODUCT/WAREHOUSE/ADDON) يستبدلها اختبار PHP بمعرّفات حقيقية.
 * تحديث العقد عمداً: FLOWERS_ADMIN_WRITE_CONTRACT=1 npx vitest run admin-journey-contract (ثم FLOWERS_WRITE_CONTRACT=1 على PHP).
 */
const DIR = resolve(process.cwd(), '../contracts/flowers-admin-journey');
const WRITE = process.env.FLOWERS_ADMIN_WRITE_CONTRACT === '1';
const readJson = (file: string) => JSON.parse(readFileSync(resolve(DIR, file), 'utf8'));
const response = (name: string) => readJson(`responses/${name}.json`);

type Recorded = { method: string; path: string; body: unknown };
const recorded: Record<string, Recorded> = {};
let current = '';

beforeEach(() => {
  apiMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
    recorded[current] = { method: options?.method ?? 'GET', path, body: options?.body ?? null };

    return WRITE && !existsSync(resolve(DIR, `responses/${current}.json`)) ? { data: {} } : response(current);
  });
});
afterEach(() => apiMock.mockReset());

const STEPS = [
  '01-gift-settings',
  '02-schedule-settings',
  '03-schedule-slots',
  '04-schedule-blocked-dates',
  '05-fulfillment',
  '06-preparation',
  '07-personalization',
  '08-addons',
  '09-content',
  '10-read-gift-settings',
  '11-read-delivery-schedule',
  '12-vertical-setup',
] as const;

const field = (over: Partial<PersonalizationField>): PersonalizationField => ({
  key: 'cake-text', type: 'text', label: 'الكتابة على الكيكة', labelEn: 'Cake text', helpText: '', isRequired: true, maxLength: 20, isActive: true, options: [], persisted: false, ...over,
});
const FIELDS: PersonalizationField[] = [
  field({}),
  field({ key: 'ribbon', type: 'select', label: 'لون الشريط', labelEn: '', isRequired: false, maxLength: null, options: [{ valueKey: 'red', label: 'أحمر', labelEn: 'Red', isActive: true }, { valueKey: 'gold', label: 'ذهبي', labelEn: '', isActive: false }] }),
];
const ADDONS: AddonRow[] = [{ addonProductId: 'ADDON', addonVariantId: null, name: 'شوكولاتة', nameEn: null, sku: null, productIsActive: true, maxQuantity: 3, isActive: true }];
const BLOCKS: ContentBlock[] = [
  { type: 'composition', body: '٢٤ وردة جوري', bodyEn: '24 roses', isActive: true },
  { type: 'care', body: 'تُحفظ في ماء بارد', bodyEn: '', isActive: false },
];

/**
 * الألواح الفعلية تمرّر دائماً بصمة المستند التي قرأته عند التحميل (`expected_revision`). العقد يسجّل هذا الحقل برمز نائب،
 * ويستبدله اختبار PHP وقت التشغيل بالبصمة الحيّة من قراءة المستند نفسه قبل الحفظ — فيُختبر الطلب الحاوي للبصمة كما تبنيه
 * الواجهة (اسم الحقل وشكله) لا نسخةٌ بلا بصمة.
 */
const REVISION = '<REVISION>';

const RUN: Record<(typeof STEPS)[number], () => Promise<unknown>> = {
  '01-gift-settings': () => saveGiftPolicy('STORE', { enabled: true, messageMaxLength: 180, allowHideSender: true, recipientPhoneRequired: false }),
  '02-schedule-settings': () => saveSettings('STORE', { enabled: true, required: true, timezone: 'Asia/Riyadh', leadTimeMinutes: 90, cutoffTime: '18:00', maxDaysAhead: 30 }),
  '03-schedule-slots': () => saveSlots('STORE', [
    { id: null, method: 'delivery', label: 'صباحاً', labelEn: 'Morning', startTime: '09:00', endTime: '12:00', weekdays: [0, 1, 2, 3, 4], capacity: 20, shippingZoneId: null, isActive: true },
    { id: null, method: 'pickup', label: 'مساءً', labelEn: null, startTime: '16:00', endTime: '20:00', weekdays: [0, 1, 2, 3, 4, 5, 6], capacity: null, shippingZoneId: null, isActive: false },
  ], REVISION),
  '04-schedule-blocked-dates': () => saveBlockedDates('STORE', [{ date: '2030-02-14', method: 'all', reason: 'عطلة' }, { date: '2030-03-01', method: 'pickup', reason: null }], REVISION),
  '05-fulfillment': () => saveFulfillment('STORE', 'WAREHOUSE'),
  '06-preparation': () => savePreparation('PRODUCT', 180),
  '07-personalization': () => savePersonalization('PRODUCT', FIELDS, REVISION),
  '08-addons': () => saveAddons('PRODUCT', ADDONS, REVISION),
  '09-content': () => saveContent('PRODUCT', BLOCKS, REVISION),
  '10-read-gift-settings': () => loadGiftPolicy('STORE'),
  '11-read-delivery-schedule': () => loadSchedule('STORE'),
  '12-vertical-setup': () => loadVerticalSetup('STORE'),
};

describe('merchant admin journey contract', () => {
  // التوليد يبدأ من خريطة فارغة (لا دمج مع القديمة): خطوةٌ حُذفت أو أُعيدت تسميتها لا تبقى طلباً يتيماً يُعاد تشغيله.
  beforeAll(() => {
    if (WRITE) {
      mkdirSync(DIR, { recursive: true });
      writeFileSync(resolve(DIR, 'requests.json'), '{}\n');
    }
  });

  it('the stored request map holds exactly the journey steps (no stale or missing operation)', () => {
    if (WRITE) return;
    expect(Object.keys(readJson('requests.json')).sort()).toEqual([...STEPS].sort());
  });

  for (const step of STEPS) {
    it(`${step}: client request matches the shared contract and the real response parses`, async () => {
      current = step;
      const result = (await RUN[step]()) as { ok?: boolean; data?: unknown } | null;

      if (WRITE) {
        mkdirSync(DIR, { recursive: true });
        const all = existsSync(resolve(DIR, 'requests.json')) ? readJson('requests.json') : {};
        all[step] = recorded[step];
        writeFileSync(resolve(DIR, 'requests.json'), `${JSON.stringify(Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`);

        return;
      }

      expect(recorded[step]).toEqual(readJson('requests.json')[step]);
      // خطوة الإعداد تُعيد قيمة مباشرة؛ بقية الخطوات نتيجة مصنَّفة يجب أن تكون ناجحة (لا رفض ولا فشل تحليل).
      if (step === '12-vertical-setup') {
        expect(result).not.toBeNull();
      } else {
        expect(result?.ok, JSON.stringify(result)).toBe(true);
      }
    });
  }

  it('what the merchant saved is exactly what the server returns (round trip)', async () => {
    if (WRITE) return;
    current = '01-gift-settings';
    const gift = await saveGiftPolicy('STORE', { enabled: true, messageMaxLength: 180, allowHideSender: true, recipientPhoneRequired: false });
    expect(gift).toEqual({ ok: true, data: { enabled: true, messageMaxLength: 180, allowHideSender: true, recipientPhoneRequired: false } });

    current = '11-read-delivery-schedule';
    const schedule = await loadSchedule('STORE');
    expect(schedule.ok && schedule.data.settings).toEqual({ enabled: true, required: true, timezone: 'Asia/Riyadh', leadTimeMinutes: 90, cutoffTime: '18:00', maxDaysAhead: 30 });
    expect(schedule.ok && schedule.data.slots.map(({ id, ...rest }) => ({ hasId: typeof id === 'string' && id.length > 0, ...rest }))).toEqual([
      { hasId: true, method: 'delivery', label: 'صباحاً', labelEn: 'Morning', startTime: '09:00', endTime: '12:00', weekdays: [0, 1, 2, 3, 4], capacity: 20, shippingZoneId: null, isActive: true },
      { hasId: true, method: 'pickup', label: 'مساءً', labelEn: null, startTime: '16:00', endTime: '20:00', weekdays: [0, 1, 2, 3, 4, 5, 6], capacity: null, shippingZoneId: null, isActive: false },
    ]);
    expect(schedule.ok && schedule.data.blockedDates).toEqual([{ date: '2030-02-14', method: 'all', reason: 'عطلة' }, { date: '2030-03-01', method: 'pickup', reason: null }]);

    current = '06-preparation';
    expect(await savePreparation('PRODUCT', 180)).toEqual({ ok: true, data: { minutes: 180 } });

    current = '07-personalization';
    const personalization = await savePersonalization('PRODUCT', FIELDS);
    expect(personalization.ok && personalization.data.fields.map((f) => ({ ...f, persisted: false }))).toEqual(
      FIELDS.map((f) => ({ ...f, persisted: false, maxLength: f.type === 'select' ? null : f.maxLength })),
    );
    // البصمة تعود مع المستند: عليها يقوم رفض الاستبدال القديم داخل القفل.
    expect(personalization.ok && personalization.data.revision).toBe('<sha1-revision>');

    current = '09-content';
    const content = await saveContent('PRODUCT', BLOCKS);
    expect(content.ok && content.data.blocks).toEqual(BLOCKS);
    expect(content.ok && content.data.revision).toBe('<sha1-revision>');

    current = '08-addons';
    const addons = await saveAddons('PRODUCT', ADDONS);
    // المعرّف رمز نائب في العقد (يستبدله PHP بمعرّف حقيقي ثم يُطبَّع)؛ المهم أن الخادم أعاد المنتج الهدف نفسه نشطاً.
    expect(addons.ok && addons.data.rows.map((a) => ({ hasProduct: /^[0-9a-f-]{36}$/.test(a.addonProductId), name: a.name, qty: a.maxQuantity, active: a.isActive, productActive: a.productIsActive }))).toEqual([
      { hasProduct: true, name: 'شوكولاتة', qty: 3, active: true, productActive: true },
    ]);
    expect(addons.ok && addons.data.revision).toBe('<sha1-revision>');
  });

  it('the checklist after the journey marks every capability the journey configured', async () => {
    if (WRITE) return;
    current = '12-vertical-setup';
    const setup = await loadVerticalSetup('STORE');
    const state = (key: string) => setup?.items.find((item) => item.key === key)?.state;
    for (const key of ['occasions', 'recipients', 'gift_message', 'delivery_scheduling', 'same_day_delivery', 'personalization', 'add_ons', 'structured_content']) {
      expect(state(key), key).toBe('configured');
    }
    expect(state('vertical_sections')).toBe('not_configured');
  });
});

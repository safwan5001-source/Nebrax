'use client';

import { useEffect, useState } from 'react';
import { MapPin, User, Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { FieldGrid, FieldSpan, FormSection, ToggleField } from '@/components/nebrax';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { riyalToMinor } from '@/lib/money';
import { api } from '@/lib/api';

/**
 * نموذج بيانات الطرف — مشترك بين شاشتَي الإنشاء والتعديل.
 *
 * الحقول كلّها نصّية في الحالة (كما يكتبها المستخدم) وتُحوَّل عند الإرسال فقط:
 * المبالغ إلى هللات، والفراغ إلى `null` — فالخادم يفرّق بين «صفر» و«غير محدَّد».
 *
 * **الرصيد الافتتاحي في الإنشاء وحده.** هو فعلٌ محاسبي يولّد قيداً مرحّلاً
 * (مدين 1130 / دائن 3130)، والقيود بعد الترحيل لا تُعدَّل — تُصحَّح بقيد عكسي.
 * إظهاره في التعديل كان سيوهم بأنه يُغيَّر، بينما الخادم يتجاهله صامتاً.
 */
export interface PartnerFormValues {
  name: string; name_en: string; type: string; entity_type: string;
  phone: string; mobile: string; address: string; city: string;
  vat_number: string; cr_number: string; code: string; email: string;
  classification: string;
  building_no: string; street: string; district: string; postal_code: string; country: string;
  opening_balance: string; opening_balance_date: string;
  credit_limit: string; credit_period: string; default_price_list_id: string;
  is_active: boolean;
}

export const EMPTY_PARTNER_FORM: PartnerFormValues = {
  name: '', name_en: '', type: 'customer', entity_type: 'commercial',
  phone: '', mobile: '', address: '', city: '',
  vat_number: '', cr_number: '', code: '', email: '',
  classification: '',
  building_no: '', street: '', district: '', postal_code: '', country: '',
  opening_balance: '', opening_balance_date: '',
  credit_limit: '', credit_period: '', default_price_list_id: '',
  is_active: true,
};

/** شكل الطرف كما يعيده الـ API (المبالغ بالريال كنصّ). */
export interface PartnerApi {
  name: string; name_en: string | null; type: string; entity_type: string | null;
  phone: string | null; mobile: string | null; address: string | null; city: string | null;
  vat_number: string | null; cr_number: string | null; code: string | null; email: string | null;
  classification: string | null;
  building_no: string | null; street: string | null; district: string | null;
  postal_code: string | null; country: string | null;
  credit_limit: string | null; credit_period: number | null;
  default_price_list_id: string | null;
  is_active: boolean;
}

/** يملأ النموذج من استجابة الـ API — `null` تصير نصّاً فارغاً لا "null". */
export function partnerFormFromApi(p: PartnerApi): PartnerFormValues {
  return {
    ...EMPTY_PARTNER_FORM,
    name: p.name ?? '',
    name_en: p.name_en ?? '',
    type: p.type ?? 'customer',
    entity_type: p.entity_type ?? 'commercial',
    phone: p.phone ?? '',
    mobile: p.mobile ?? '',
    address: p.address ?? '',
    city: p.city ?? '',
    vat_number: p.vat_number ?? '',
    cr_number: p.cr_number ?? '',
    code: p.code ?? '',
    email: p.email ?? '',
    classification: p.classification ?? '',
    building_no: p.building_no ?? '',
    street: p.street ?? '',
    district: p.district ?? '',
    postal_code: p.postal_code ?? '',
    country: p.country ?? '',
    credit_limit: p.credit_limit ?? '',
    credit_period: p.credit_period != null ? String(p.credit_period) : '',
    default_price_list_id: p.default_price_list_id ?? '',
    is_active: p.is_active !== false,
  };
}

/** يحوّل النموذج إلى جسم الطلب. الرصيد الافتتاحي يُرسَل عند الإنشاء فقط. */
export function partnerFormToPayload(form: PartnerFormValues, withOpeningBalance: boolean): Record<string, unknown> {
  const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

  const payload: Record<string, unknown> = {
    name: form.name.trim(),
    name_en: orNull(form.name_en),
    type: form.type,
    entity_type: form.entity_type,
    phone: orNull(form.phone),
    mobile: orNull(form.mobile),
    address: orNull(form.address),
    city: orNull(form.city),
    building_no: orNull(form.building_no),
    street: orNull(form.street),
    district: orNull(form.district),
    postal_code: orNull(form.postal_code),
    country: orNull(form.country),
    vat_number: orNull(form.vat_number),
    cr_number: orNull(form.cr_number),
    code: orNull(form.code),
    email: orNull(form.email),
    classification: orNull(form.classification),
    credit_limit: form.credit_limit !== '' ? riyalToMinor(form.credit_limit) : null,
    credit_period: form.credit_period !== '' ? Number(form.credit_period) : null,
    default_price_list_id: form.default_price_list_id || null,
    is_active: form.is_active,
  };

  if (withOpeningBalance) {
    payload.opening_balance = form.opening_balance !== '' ? riyalToMinor(form.opening_balance) : null;
    payload.opening_balance_date = orNull(form.opening_balance_date);
  }

  return payload;
}

interface PriceList { id: string; name: string; is_active: boolean }

export function PartnerForm({
  form,
  onChange,
  mode,
}: {
  form: PartnerFormValues;
  onChange: <K extends keyof PartnerFormValues>(key: K, value: PartnerFormValues[K]) => void;
  mode: 'create' | 'edit';
}) {
  const t = useTranslations('partners');
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const isCustomer = form.type === 'customer' || form.type === 'both';

  useEffect(() => {
    api<{ data: PriceList[] }>('/price-lists')
      .then((response) => setPriceLists(response.data))
      .catch(() => {});
  }, []);

  // النوع هنا يختاره المستخدم (عميل/مورد/كلاهما)، فالتسمية تتبعه لحظةً بلحظة.
  // و«كلاهما» لا تصلح له «نوع العميل» ولا «نوع المورّد» — فيَرِد المحايد.
  const entityLabel = t(
    form.type === 'supplier' ? 'entity_type_supplier'
      : form.type === 'customer' ? 'entity_type_customer'
      : 'entity_type'
  );

  return (
    <>
      <FormSection title={t('customer_details')} icon={User}>
        <FieldGrid>
          <FieldSpan>
            <Label htmlFor="name">{t('name')} <span className="text-negative">*</span></Label>
            <Input id="name" className="mt-1.5" value={form.name} required onChange={(e) => onChange('name', e.target.value)} />
          </FieldSpan>
          <div>
            <Label htmlFor="name_en">{t('name_en')}</Label>
            <Input id="name_en" className="mt-1.5" dir="ltr" value={form.name_en} onChange={(e) => onChange('name_en', e.target.value)} />
          </div>
          {/* النوع: كان غائباً عن شاشة الإنشاء فكان كل طرف يُنشأ «عميلاً». */}
          <div>
            <Label htmlFor="type">{t('type')}</Label>
            <Select
              id="type" className="mt-1.5" value={form.type}
              onChange={(e) => {
                onChange('type', e.target.value);
                // الخادم يرفض قائمة سعر افتراضية لطرفٍ ليس عميلاً (422)، فتُمحى هنا
                // قبل الإرسال لا بعد الرفض.
                if (e.target.value === 'supplier') onChange('default_price_list_id', '');
              }}
            >
              <option value="customer">{t('customer')}</option>
              <option value="supplier">{t('supplier')}</option>
              <option value="both">{t('both')}</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="entity_type">{entityLabel}</Label>
            <Select id="entity_type" className="mt-1.5" value={form.entity_type} onChange={(e) => onChange('entity_type', e.target.value)}>
              <option value="commercial">{t('commercial')}</option>
              <option value="individual">{t('individual')}</option>
            </Select>
          </div>
          {/* الرمز مُعرّفٌ تشغيلي يُبحث به: LTR وخط Mono مهما كان اتجاه الصفحة. */}
          <div>
            <Label htmlFor="code">{t('code')}</Label>
            <Input id="code" className="num mt-1.5" dir="ltr" value={form.code} onChange={(e) => onChange('code', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="classification">{t('classification')}</Label>
            <Input
              id="classification" className="mt-1.5" list="partner-classifications" placeholder={t('classification_hint')}
              value={form.classification} onChange={(e) => onChange('classification', e.target.value)}
            />
            <datalist id="partner-classifications">
              <option value="VIP" />
              <option value={t('cls_wholesale')} />
              <option value={t('cls_retail')} />
              <option value={t('cls_government')} />
            </datalist>
          </div>
          <FieldSpan>
            <ToggleField
              id="partner-active"
              label={t('active')}
              hint={t('active_hint')}
              checked={form.is_active}
              onCheckedChange={(value) => onChange('is_active', value)}
            />
          </FieldSpan>
        </FieldGrid>
      </FormSection>

      <FormSection title={t('contact_details')} icon={User}>
        <FieldGrid>
          {/* الهاتف والجوال: لوحة أرقام على الجوال، واتجاه لاتيني فلا ينكسر ترتيب
              رمز الدولة داخل صفحة عربية. */}
          <div>
            <Label htmlFor="phone">{t('phone')}</Label>
            <Input id="phone" className="num mt-1.5" type="tel" inputMode="tel" dir="ltr" value={form.phone} onChange={(e) => onChange('phone', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="mobile">{t('mobile')}</Label>
            <Input id="mobile" className="num mt-1.5" type="tel" inputMode="tel" dir="ltr" value={form.mobile} onChange={(e) => onChange('mobile', e.target.value)} />
          </div>
          <FieldSpan>
            <Label htmlFor="email">{t('email')}</Label>
            <Input id="email" className="mt-1.5" type="email" inputMode="email" dir="ltr" value={form.email} onChange={(e) => onChange('email', e.target.value)} />
          </FieldSpan>
        </FieldGrid>
      </FormSection>

      <FormSection title={t('tax_identity')} icon={Wallet}>
        <FieldGrid>
          <div>
            <Label htmlFor="vat">{t('vat_number')}</Label>
            <Input
              id="vat" className="num mt-1.5" dir="ltr" inputMode="numeric" maxLength={15} placeholder={t('vat_hint')}
              value={form.vat_number} onChange={(e) => onChange('vat_number', e.target.value)}
              aria-describedby="vat-hint"
            />
            <p id="vat-hint" className="mt-1 text-[11px] leading-relaxed text-muted">{t('vat_length_hint')}</p>
          </div>
          <div>
            <Label htmlFor="cr">{t('cr_number')}</Label>
            <Input id="cr" className="num mt-1.5" dir="ltr" inputMode="numeric" value={form.cr_number} onChange={(e) => onChange('cr_number', e.target.value)} />
          </div>
        </FieldGrid>
      </FormSection>

      <FormSection title={t('account_details')} icon={Wallet}>
        <FieldGrid>
          {mode === 'create' ? (
            <>
              <div>
                <Label htmlFor="ob">{t('opening_balance')}</Label>
                <Input
                  id="ob" className="num mt-1.5 text-end" inputMode="decimal" dir="ltr" placeholder="0.00"
                  value={form.opening_balance} onChange={(e) => onChange('opening_balance', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="obd">{t('opening_balance_date')}</Label>
                <Input
                  id="obd" className="mt-1.5" type="date" dir="ltr"
                  value={form.opening_balance_date} onChange={(e) => onChange('opening_balance_date', e.target.value)}
                />
              </div>
              <FieldSpan>
                <p className="text-[11px] leading-relaxed text-muted">{t('opening_balance_hint')}</p>
              </FieldSpan>
            </>
          ) : (
            <FieldSpan>
              <p className="rounded bg-primary-soft px-3 py-2 text-[11px] leading-relaxed text-primary">
                {t('opening_balance_locked')}
              </p>
            </FieldSpan>
          )}

          <div>
            <Label htmlFor="climit">{t('credit_limit')}</Label>
            <Input
              id="climit" className="num mt-1.5 text-end" inputMode="decimal" dir="ltr" placeholder="0.00"
              value={form.credit_limit} onChange={(e) => onChange('credit_limit', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="cperiod">{t('credit_period')}</Label>
            <Input
              id="cperiod" className="num mt-1.5 text-end" inputMode="numeric" dir="ltr" placeholder="0"
              value={form.credit_period} onChange={(e) => onChange('credit_period', e.target.value)}
            />
          </div>
          <FieldSpan>
            <p className="text-[11px] leading-relaxed text-muted">{t('credit_limit_hint')}</p>
          </FieldSpan>

          {isCustomer && (
            <FieldSpan>
              <Label htmlFor="default-price-list">{t('default_price_list')}</Label>
              <Select
                id="default-price-list" className="mt-1.5" value={form.default_price_list_id}
                onChange={(e) => onChange('default_price_list_id', e.target.value)}
                aria-describedby="default-price-list-hint"
              >
                <option value="">{t('default_price_list_none')}</option>
                {priceLists.map((priceList) => (
                  <option
                    key={priceList.id} value={priceList.id}
                    disabled={!priceList.is_active && priceList.id !== form.default_price_list_id}
                  >
                    {priceList.name}{!priceList.is_active ? ` — ${t('default_price_list_inactive')}` : ''}
                  </option>
                ))}
              </Select>
              <p id="default-price-list-hint" className="mt-1 text-[11px] leading-relaxed text-muted">{t('default_price_list_hint')}</p>
            </FieldSpan>
          )}
        </FieldGrid>
      </FormSection>

      <FormSection title={t('national_address')} icon={MapPin}>
        <FieldGrid columns={3}>
          <FieldSpan>
            <Label htmlFor="address">{t('address')}</Label>
            <Input id="address" className="mt-1.5" value={form.address} onChange={(e) => onChange('address', e.target.value)} />
          </FieldSpan>
          <div>
            <Label htmlFor="city">{t('city')}</Label>
            <Input id="city" className="mt-1.5" value={form.city} onChange={(e) => onChange('city', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="district">{t('district')}</Label>
            <Input id="district" className="mt-1.5" value={form.district} onChange={(e) => onChange('district', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="street">{t('street')}</Label>
            <Input id="street" className="mt-1.5" value={form.street} onChange={(e) => onChange('street', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="building_no">{t('building_no')}</Label>
            <Input id="building_no" className="num mt-1.5" dir="ltr" inputMode="numeric" value={form.building_no} onChange={(e) => onChange('building_no', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="postal_code">{t('postal_code')}</Label>
            <Input id="postal_code" className="num mt-1.5" dir="ltr" inputMode="numeric" value={form.postal_code} onChange={(e) => onChange('postal_code', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="country">{t('country')}</Label>
            <Input id="country" className="mt-1.5" dir="ltr" placeholder="SA" value={form.country} onChange={(e) => onChange('country', e.target.value)} />
          </div>
        </FieldGrid>
      </FormSection>
    </>
  );
}

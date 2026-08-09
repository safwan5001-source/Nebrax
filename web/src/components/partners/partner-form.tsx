'use client';

import { MapPin, User, Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { riyalToMinor } from '@/lib/money';

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
  credit_limit: string; credit_period: string;
  is_active: boolean;
}

export const EMPTY_PARTNER_FORM: PartnerFormValues = {
  name: '', name_en: '', type: 'customer', entity_type: 'commercial',
  phone: '', mobile: '', address: '', city: '',
  vat_number: '', cr_number: '', code: '', email: '',
  classification: '',
  building_no: '', street: '', district: '', postal_code: '', country: '',
  opening_balance: '', opening_balance_date: '',
  credit_limit: '', credit_period: '',
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
    is_active: form.is_active,
  };

  if (withOpeningBalance) {
    payload.opening_balance = form.opening_balance !== '' ? riyalToMinor(form.opening_balance) : null;
    payload.opening_balance_date = orNull(form.opening_balance_date);
  }

  return payload;
}

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

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      {/* بيانات الطرف */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-4 w-4 text-primary" strokeWidth={1.8} />
            {t('customer_details')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="name">{t('name')} <span className="text-negative">*</span></Label>
              <Input id="name" value={form.name} onChange={(e) => onChange('name', e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name_en">{t('name_en')}</Label>
              <Input id="name_en" dir="ltr" value={form.name_en} onChange={(e) => onChange('name_en', e.target.value)} />
            </div>
            {/* النوع: كان غائباً عن شاشة الإنشاء فكان كل طرف يُنشأ «عميلاً». */}
            <div className="space-y-1.5">
              <Label htmlFor="type">{t('type')}</Label>
              <Select id="type" value={form.type} onChange={(e) => onChange('type', e.target.value)}>
                <option value="customer">{t('customer')}</option>
                <option value="supplier">{t('supplier')}</option>
                <option value="both">{t('both')}</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="entity_type">{t('entity_type')}</Label>
              <Select id="entity_type" value={form.entity_type} onChange={(e) => onChange('entity_type', e.target.value)}>
                <option value="commercial">{t('commercial')}</option>
                <option value="individual">{t('individual')}</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">{t('phone')}</Label>
              <Input id="phone" dir="ltr" value={form.phone} onChange={(e) => onChange('phone', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mobile">{t('mobile')}</Label>
              <Input id="mobile" dir="ltr" value={form.mobile} onChange={(e) => onChange('mobile', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="city">{t('city')}</Label>
              <Input id="city" value={form.city} onChange={(e) => onChange('city', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vat">{t('vat_number')}</Label>
              <Input
                id="vat" dir="ltr" className="num" maxLength={15} placeholder={t('vat_hint')}
                value={form.vat_number} onChange={(e) => onChange('vat_number', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cr">{t('cr_number')}</Label>
              <Input id="cr" dir="ltr" className="num" value={form.cr_number} onChange={(e) => onChange('cr_number', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="classification">{t('classification')}</Label>
              <Input
                id="classification" list="partner-classifications" placeholder={t('classification_hint')}
                value={form.classification} onChange={(e) => onChange('classification', e.target.value)}
              />
              <datalist id="partner-classifications">
                <option value="VIP" />
                <option value={t('cls_wholesale')} />
                <option value={t('cls_retail')} />
                <option value={t('cls_government')} />
              </datalist>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* بيانات الحساب */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" strokeWidth={1.8} />
            {t('account_details')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="code">{t('code')}</Label>
              <Input id="code" dir="ltr" className="num" value={form.code} onChange={(e) => onChange('code', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">{t('email')}</Label>
              <Input id="email" type="email" dir="ltr" value={form.email} onChange={(e) => onChange('email', e.target.value)} />
            </div>

            {mode === 'create' ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="ob">{t('opening_balance')}</Label>
                  <Input
                    id="ob" inputMode="decimal" className="num text-end" placeholder="0.00"
                    value={form.opening_balance} onChange={(e) => onChange('opening_balance', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="obd">{t('opening_balance_date')}</Label>
                  <Input
                    id="obd" type="date" dir="ltr"
                    value={form.opening_balance_date} onChange={(e) => onChange('opening_balance_date', e.target.value)}
                  />
                </div>
                <p className="text-[11px] text-muted sm:col-span-2">{t('opening_balance_hint')}</p>
              </>
            ) : (
              <p className="rounded bg-primary-soft px-3 py-2 text-[11px] leading-relaxed text-primary sm:col-span-2">
                {t('opening_balance_locked')}
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="climit">{t('credit_limit')}</Label>
              <Input
                id="climit" inputMode="decimal" className="num text-end" placeholder="0.00"
                value={form.credit_limit} onChange={(e) => onChange('credit_limit', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cperiod">{t('credit_period')}</Label>
              <Input
                id="cperiod" inputMode="numeric" className="num text-end" placeholder="0"
                value={form.credit_period} onChange={(e) => onChange('credit_period', e.target.value)}
              />
            </div>
            <p className="text-[11px] text-muted sm:col-span-2">{t('credit_limit_hint')}</p>

            <div className="space-y-1.5 sm:col-span-2">
              <label className="flex items-center gap-2 pt-1 text-sm text-text">
                <input type="checkbox" checked={form.is_active} onChange={(e) => onChange('is_active', e.target.checked)} />
                {t('active')}
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* العنوان الوطني */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" strokeWidth={1.8} />
            {t('national_address')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
              <Label htmlFor="address">{t('address')}</Label>
              <Input id="address" value={form.address} onChange={(e) => onChange('address', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="building_no">{t('building_no')}</Label>
              <Input id="building_no" dir="ltr" className="num" value={form.building_no} onChange={(e) => onChange('building_no', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="street">{t('street')}</Label>
              <Input id="street" value={form.street} onChange={(e) => onChange('street', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="district">{t('district')}</Label>
              <Input id="district" value={form.district} onChange={(e) => onChange('district', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="postal_code">{t('postal_code')}</Label>
              <Input id="postal_code" dir="ltr" className="num" value={form.postal_code} onChange={(e) => onChange('postal_code', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="country">{t('country')}</Label>
              <Input id="country" dir="ltr" placeholder="SA" value={form.country} onChange={(e) => onChange('country', e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

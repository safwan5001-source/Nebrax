'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

export interface Partner {
  id: string;
  name: string;
  type: string;
  entity_type?: string;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
}

/**
 * ═══ إنشاء طرف سريع من داخل مستند ═══
 *
 * ليس نموذج البيانات الأساسية: مكانه `/partners/new` و`/partners/[id]/edit`
 * (الرقم الضريبي، السجل التجاري، الرمز، شروط الائتمان، قائمة السعر الافتراضية،
 * العنوان الوطني، الرصيد الافتتاحي).
 *
 * غرضه أن كاتب الفاتورة وجد عميلاً غير مسجَّل فيسجّل ما يكفي لإكمال المستند.
 * ولذلك **لا تعديل من هنا**: تحرير طرفٍ قائم عبر ستة حقول كان يخفي ثمانية عشر
 * حقلاً ويوهم بأنها كلّ بياناته.
 */
export function PartnerDialog({
  open,
  onClose,
  onSaved,
  defaultType = 'customer',
  addTitle,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** نوع الطرف عند الإنشاء — 'customer' لشاشة العملاء، 'supplier' لشاشة الموردين. */
  defaultType?: string;
  /** عنوانٌ يخصّ سياق الشاشة (مورّد/عميل)؛ بلا تمرير تُستخدم صيغة «الطرف» العامة. */
  addTitle?: string;
}) {
  const tp = useTranslations('partners');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [form, setForm] = useState<Partner>({
    id: '', name: '', type: defaultType, entity_type: 'commercial', email: '', phone: '', city: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof Partner, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // الحقل واحد (تجاري/فردي) وسياقه ثلاثة: «نوع العميل» على مورّدٍ نصٌّ خاطئ
  // يجعل المستخدم يشكّ أنه في النافذة الغلط.
  const entityLabel = tp(
    form.type === 'supplier' ? 'entity_type_supplier'
      : form.type === 'customer' ? 'entity_type_customer'
      : 'entity_type'
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      name: form.name,
      type: form.type || defaultType,
      entity_type: form.entity_type || 'commercial',
      email: form.email || null,
      phone: form.phone || null,
      city: form.city || null,
    };
    try {
      await api('/partners', { method: 'POST', body });
      success(tc('created'));
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={addTitle ?? tp('add')}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs leading-relaxed text-muted">{tp('quick_add_hint')}</p>
        <div className="space-y-1.5">
          <Label htmlFor="name">{tp('name')}</Label>
          <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="entity_type">{entityLabel}</Label>
          <Select id="entity_type" value={form.entity_type ?? 'commercial'} onChange={(e) => set('entity_type', e.target.value)}>
            <option value="commercial">{tp('commercial')}</option>
            <option value="individual">{tp('individual')}</option>
          </Select>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="email">{tp('email')}</Label>
            <Input id="email" type="email" inputMode="email" dir="ltr" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">{tp('phone')}</Label>
            <Input id="phone" className="num" type="tel" inputMode="tel" dir="ltr" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="city">{tp('city')}</Label>
          <Input id="city" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} />
        </div>

        {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {tp('cancel')}
          </Button>
          <Button type="submit" disabled={saving || !form.name.trim()}>
            {tp('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

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
import { useNumberPreview } from '@/lib/use-number-preview';
import { riyalToMinor } from '@/lib/money';

/**
 * ═══ إنشاء منتج سريع من داخل مستند ═══
 *
 * هذا الحوار **ليس نموذج البيانات الأساسية**. مكان ذلك `/products/new` و
 * `/products/[id]/edit`: التصنيف والعلامة والمورّد والحسابات والوحدات والصور
 * والرصيد الابتدائي كلّها هناك.
 *
 * غرضه واحد: كاتب الفاتورة اكتشف صنفاً غير مسجَّل، فيسجّل أقلّ ما يلزم لإكمال
 * السطر ويعود إليه فوراً. حشرُ النموذج الكامل في نافذة كان يعطي ثلاثة أعمدة
 * ثابتة بعرض ~١٠٠px على شاشة هاتف، ويطلب من كاتب الفاتورة قرارات كتالوج
 * ليست قراره ولا وقتها.
 *
 * النقطة النهائية والحمولة كما هي (`POST /products`)، والاختيار التلقائي
 * للمنتج المُنشأ يبقى مسؤولية المستدعي.
 */
export function ProductDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const { success } = useToast();

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [type, setType] = useState('good');
  const [unit, setUnit] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [taxRate, setTaxRate] = useState('15');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { number: suggestedSku } = useNumberPreview('product', { enabled: open });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api('/products', {
        method: 'POST',
        body: {
          name: name.trim(),
          // فارغاً تعني «ولّده الخادم» — يخصّصه `ProductController::store` تحت القفل.
          sku: sku.trim() || null,
          barcode: barcode.trim() || null,
          type,
          unit: unit.trim() || null,
          sale_price: riyalToMinor(salePrice),
          purchase_price: riyalToMinor(purchasePrice),
          tax_rate: Number(taxRate) || 0,
          track_inventory: false,
          is_active: true,
        },
      });
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
    <Dialog open={open} onClose={onClose} title={t('quick_add')}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs leading-relaxed text-muted">{t('quick_add_hint')}</p>

        <div className="space-y-1.5">
          <Label htmlFor="quick-product-name">{t('name')} <span className="text-negative">*</span></Label>
          <Input id="quick-product-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="quick-product-sku">{t('sku')}</Label>
            <Input
              id="quick-product-sku" className="num" dir="ltr" value={sku}
              placeholder={suggestedSku || t('sku_auto_placeholder')}
              onChange={(e) => setSku(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quick-product-barcode">{t('barcode')}</Label>
            <Input
              id="quick-product-barcode" className="num" dir="ltr" inputMode="numeric"
              value={barcode} onChange={(e) => setBarcode(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quick-product-type">{t('type')}</Label>
            <Select id="quick-product-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="good">{t('good')}</option>
              <option value="service">{t('service')}</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quick-product-unit">{t('unit')}</Label>
            <Input id="quick-product-unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="quick-product-sale">{t('sale_price')} <span className="text-negative">*</span></Label>
            <Input
              id="quick-product-sale" className="num text-end" inputMode="decimal" dir="ltr" placeholder="0.00"
              value={salePrice} onChange={(e) => setSalePrice(e.target.value)} required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quick-product-purchase">{t('purchase_price')}</Label>
            <Input
              id="quick-product-purchase" className="num text-end" inputMode="decimal" dir="ltr" placeholder="0.00"
              value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quick-product-tax">{t('tax_rate')}</Label>
            <Input
              id="quick-product-tax" className="num text-end" type="number" min={0} max={100} dir="ltr"
              value={taxRate} onChange={(e) => setTaxRate(e.target.value)}
            />
          </div>
        </div>

        {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" disabled={saving || !name.trim()}>{t('save')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

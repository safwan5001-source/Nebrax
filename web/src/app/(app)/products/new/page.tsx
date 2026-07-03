'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Package, Tag, Warehouse, SlidersHorizontal, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { riyalToMinor } from '@/lib/money';

export default function NewProductPage() {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [type, setType] = useState('good');
  const [unit, setUnit] = useState('piece');
  const [salePrice, setSalePrice] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [taxRate, setTaxRate] = useState('15');
  const [trackInventory, setTrackInventory] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim()) { setError(tc('saveFailed')); return; }
    setSaving(true);
    setError(null);
    try {
      await api('/products', {
        method: 'POST',
        body: {
          name,
          name_en: nameEn || null,
          sku: sku || null,
          barcode: barcode || null,
          type,
          unit: unit || null,
          sale_price: riyalToMinor(salePrice),
          purchase_price: riyalToMinor(purchasePrice),
          tax_rate: Number(taxRate) || 0,
          track_inventory: trackInventory,
          is_active: isActive,
        },
      });
      success(tc('created'));
      router.push('/products');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* شريط الإجراءات */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/products')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="text-xl font-semibold text-text">{t('new_title')}</h1>
        <div className="ms-auto flex items-center gap-2">
          <Button variant="ghost" onClick={() => router.push('/products')}>{t('cancel')}</Button>
          <Button disabled={saving || !name.trim()} onClick={submit}>{t('save')}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* تفاصيل البند */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Package className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('item_details')}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">{t('name')} <span className="text-negative">*</span></Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sku">{t('sku')}</Label>
                <Input id="sku" dir="ltr" value={sku} onChange={(e) => setSku(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="name_en">{t('name_en')}</Label>
                <Input id="name_en" dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="type">{t('type')}</Label>
                <Select id="type" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="good">{t('good')}</option>
                  <option value="service">{t('service')}</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit">{t('unit')}</Label>
                <Input id="unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="barcode">{t('barcode')}</Label>
                <div className="flex gap-2">
                  <Input id="barcode" dir="ltr" className="num" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
                  <Button type="button" variant="outline" size="icon" aria-label={t('generate_barcode')} onClick={() => setBarcode('2' + String(Date.now()).slice(-12))}>
                    <RefreshCw className="h-4 w-4" strokeWidth={1.7} />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* تفاصيل التسعير */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Tag className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('pricing_details')}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="purchase_price">{t('purchase_price')}</Label>
                <Input id="purchase_price" inputMode="decimal" className="num text-end" placeholder="0.00" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sale_price">{t('sale_price')}</Label>
                <Input id="sale_price" inputMode="decimal" className="num text-end" placeholder="0.00" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tax_rate">{t('tax_rate')}</Label>
                <Input id="tax_rate" type="number" min={0} max={100} dir="ltr" className="num text-end" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* إدارة المخزون */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Warehouse className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('inventory_mgmt')}</CardTitle></CardHeader>
          <CardContent>
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" checked={trackInventory} onChange={(e) => setTrackInventory(e.target.checked)} />
              {t('track_inventory')}
            </label>
          </CardContent>
        </Card>

        {/* خيارات أكثر */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('more_options')}</CardTitle></CardHeader>
          <CardContent>
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              {t('active')}
            </label>
          </CardContent>
        </Card>
      </div>

      {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
    </div>
  );
}

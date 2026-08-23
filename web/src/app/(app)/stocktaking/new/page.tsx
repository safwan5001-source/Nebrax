'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberPreviewField } from '@/components/ui/number-preview-field';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { useNumberPreview } from '@/lib/use-number-preview';

interface Warehouse { id: string; name: string }

/** فتح جرد: اختيار المخزن وتاريخه — والالتقاط يقع لحظة الفتح لا لحظة الترحيل. */
export default function NewStocktakePage() {
  const t = useTranslations('stocktaking');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { number: suggestedNumber, loading: loadingNumber } = useNumberPreview('stocktake', { date });

  useEffect(() => {
    setDate(new Date().toISOString().slice(0, 10));
    api<{ data: Warehouse[] }>('/warehouses').then((r) => {
      setWarehouses(r.data);
      if (r.data[0]) setWarehouseId((w) => w || r.data[0].id);
    }).catch(() => {});
  }, []);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const created = await api<{ data: { id: string } }>('/stocktakes', {
        method: 'POST',
        body: { warehouse_id: warehouseId, stocktake_date: date || null, notes: notes || null },
      });
      success(tc('created'));
      router.push(`/stocktaking/${created.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/stocktaking')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="text-xl font-semibold text-text">{t('new_title')}</h1>
      </div>

      <Card className="max-w-2xl">
        <CardHeader><CardTitle>{t('details')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted">{t('open_hint')}</p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NumberPreviewField id="stocktake-number" label={t('number')} number={suggestedNumber} loading={loadingNumber} />
            <div className="space-y-1.5">
              <Label htmlFor="wh">{t('warehouse')}</Label>
              <Select id="wh" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
                <option value="" disabled>{t('choose_warehouse')}</option>
                {warehouses.map((w) => (<option key={w.id} value={w.id}>{w.name}</option>))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date">{t('date')}</Label>
              <Input id="date" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="notes">{t('notes')}</Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>

          {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

          <div className="flex justify-end">
            <Button disabled={saving || !warehouseId} onClick={submit}>{t('open_sheet')}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

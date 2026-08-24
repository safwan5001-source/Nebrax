'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { Branch } from '@/lib/branch';
import type { Warehouse } from '@/lib/warehouse';

interface FormState {
  name: string; code: string; branch_id: string; city: string; address: string;
  notes: string; is_default: boolean; is_active: boolean;
}

const EMPTY: FormState = {
  name: '', code: '', branch_id: '', city: '', address: '',
  notes: '', is_default: false, is_active: true,
};

/** نموذج إضافة/تعديل مخزن — يمرَّر `warehouseId` للتعديل. */
export function WarehouseForm({ warehouseId }: { warehouseId?: string }) {
  const t = useTranslations('warehouses');
  const tb = useTranslations('branches');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(!!warehouseId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestedCode, setSuggestedCode] = useState<string | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api<{ data: Branch[] }>('/branches').then((r) => setBranches(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (warehouseId) return;
    let active = true;

    api<{ data: { code: string } }>('/warehouses/next-code')
      .then((r) => {
        if (!active) return;
        setSuggestedCode(r.data.code);
        setForm((current) => current.code === '' ? { ...current, code: r.data.code } : current);
      })
      .catch(() => {});

    return () => { active = false; };
  }, [warehouseId]);

  useEffect(() => {
    if (!warehouseId) return;
    api<{ data: Warehouse }>(`/warehouses/${warehouseId}`)
      .then((r) => {
        const w = r.data;
        setForm({
          name: w.name ?? '', code: w.code ?? '', branch_id: w.branch_id ?? '',
          city: w.city ?? '', address: w.address ?? '', notes: w.notes ?? '',
          is_default: w.is_default, is_active: w.is_active,
        });
      })
      .catch(() => setError(tc('loadFailed')))
      .finally(() => setLoading(false));
  }, [warehouseId, tc]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const code = form.code.trim();
    const body = {
      ...form,
      // الرقم الظاهر معاينة فقط؛ يترك للخادم تخصيص الرقم النهائي عند عدم تعديله.
      code: !warehouseId && suggestedCode !== null && code === suggestedCode ? undefined : code || undefined,
      branch_id: form.branch_id || null, // لا فرع = مخزن مركزي
    };
    try {
      if (warehouseId) await api(`/warehouses/${warehouseId}`, { method: 'PUT', body });
      else await api('/warehouses', { method: 'POST', body });
      success(warehouseId ? tc('updated') : tc('created'));
      router.push('/warehouses');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSaving(false);
    }
  }

  if (loading) return <Skeleton className="h-96 w-full" />;

  const textarea =
    'min-h-20 w-full resize-y rounded border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild type="button" variant="ghost" size="icon" aria-label={tc('back')}><Link href='/warehouses'>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Link></Button>
        <h1 className="text-xl font-semibold text-text">{warehouseId ? t('edit_title') : t('new_title')}</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>{t('details')}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">{t('name')} <span className="text-negative">*</span></Label>
            <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="code">{t('code')}</Label>
            <Input id="code" dir="ltr" className="num" value={form.code} inputMode="text" onChange={(e) => set('code', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="branch">{tb('title')}</Label>
            <Select id="branch" value={form.branch_id} onChange={(e) => set('branch_id', e.target.value)}>
              <option value="">{t('no_branch')}</option>
              {branches.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
            </Select>
            <p className="text-[11px] text-muted">{t('branch_hint')}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city">{t('city')}</Label>
            <Input id="city" value={form.city} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="address">{t('address')}</Label>
            <Input id="address" value={form.address} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="notes">{t('notes')}</Label>
            <textarea id="notes" rows={3} className={textarea} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>

          <div className="flex items-start justify-between gap-3 rounded border border-border p-3">
            <div>
              <Label htmlFor="def">{t('is_default')}</Label>
              <p className="mt-1 text-[11px] text-muted">{t('is_default_hint')}</p>
            </div>
            <Switch id="def" checked={form.is_default} onCheckedChange={(v) => set('is_default', v)} aria-label={t('is_default')} />
          </div>
          <div className="flex items-start justify-between gap-3 rounded border border-border p-3">
            <div>
              <Label htmlFor="act">{t('is_active')}</Label>
              <p className="mt-1 text-[11px] text-muted">{t('is_active_hint')}</p>
            </div>
            <Switch id="act" checked={form.is_active} onCheckedChange={(v) => set('is_active', v)} aria-label={t('is_active')} />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
        <Button type="submit" disabled={saving || !form.name.trim()}>{tc('save')}</Button>
      </div>
    </form>
  );
}

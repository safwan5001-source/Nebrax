'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
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

// Leaflet يحتاج `window` — يُحمَّل في المتصفّح فقط.
const LocationPicker = dynamic(() => import('./location-picker'), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});

const COUNTRIES = ['Saudi Arabia', 'United Arab Emirates', 'Kuwait', 'Qatar', 'Bahrain', 'Oman', 'Egypt', 'Jordan'];

interface FormState {
  name: string; code: string; phone: string; mobile: string;
  address_line1: string; address_line2: string; city: string; region: string; country: string;
  description: string; working_hours: string;
  latitude: number | null; longitude: number | null; is_active: boolean;
}

const EMPTY: FormState = {
  name: '', code: '', phone: '', mobile: '',
  address_line1: '', address_line2: '', city: '', region: '', country: 'Saudi Arabia',
  description: '', working_hours: '', latitude: null, longitude: null, is_active: true,
};

/** نموذج إضافة/تعديل فرع — يمرَّر `branchId` للتعديل. */
export function BranchForm({ branchId }: { branchId?: string }) {
  const t = useTranslations('branches');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(!!branchId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestedCode, setSuggestedCode] = useState<string | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (branchId) return;
    let active = true;

    api<{ data: { code: string } }>('/branches/next-code')
      .then((r) => {
        if (!active) return;
        setSuggestedCode(r.data.code);
        setForm((current) => current.code === '' ? { ...current, code: r.data.code } : current);
      })
      .catch(() => {});

    return () => { active = false; };
  }, [branchId]);

  useEffect(() => {
    if (!branchId) return;
    api<{ data: Branch }>(`/branches/${branchId}`)
      .then((r) => {
        const b = r.data;
        setForm({
          name: b.name ?? '', code: b.code ?? '', phone: b.phone ?? '', mobile: b.mobile ?? '',
          address_line1: b.address_line1 ?? '', address_line2: b.address_line2 ?? '',
          city: b.city ?? '', region: b.region ?? '', country: b.country ?? 'Saudi Arabia',
          description: b.description ?? '', working_hours: b.working_hours ?? '',
          latitude: b.latitude ?? null, longitude: b.longitude ?? null, is_active: b.is_active,
        });
      })
      .catch(() => setError(tc('loadFailed')))
      .finally(() => setLoading(false));
  }, [branchId, tc]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const code = form.code.trim();
    // الرقم الظاهر معاينة فقط؛ يترك للخادم تخصيص الرقم النهائي عند عدم تعديله.
    const body = {
      ...form,
      code: !branchId && suggestedCode !== null && code === suggestedCode ? undefined : code || undefined,
    };
    try {
      if (branchId) await api(`/branches/${branchId}`, { method: 'PUT', body });
      else await api('/branches', { method: 'POST', body });
      success(branchId ? tc('updated') : tc('created'));
      router.push('/branches');
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
        <Button asChild type="button" variant="ghost" size="icon" aria-label={tc('back')}><Link href='/branches'>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Link></Button>
        <h1 className="text-xl font-semibold text-text">{branchId ? t('edit_title') : t('new_title')}</h1>
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
            <Label htmlFor="phone">{t('phone')}</Label>
            <Input id="phone" dir="ltr" className="num" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mobile">{t('mobile')}</Label>
            <Input id="mobile" dir="ltr" className="num" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="a1">{t('address1')}</Label>
            <Input id="a1" value={form.address_line1} onChange={(e) => set('address_line1', e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="a2">{t('address2')}</Label>
            <Input id="a2" value={form.address_line2} onChange={(e) => set('address_line2', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="city">{t('city')}</Label>
            <Input id="city" value={form.city} onChange={(e) => set('city', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="region">{t('region')}</Label>
            <Input id="region" value={form.region} onChange={(e) => set('region', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="country">{t('country')}</Label>
            <Select id="country" value={form.country} onChange={(e) => set('country', e.target.value)}>
              {COUNTRIES.map((c) => (<option key={c} value={c}>{c}</option>))}
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3 sm:pt-6">
            <Label htmlFor="active">{t('is_active')}</Label>
            <Switch id="active" checked={form.is_active} onCheckedChange={(v) => set('is_active', v)} aria-label={t('is_active')} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="desc">{t('description')}</Label>
            <textarea id="desc" rows={3} className={textarea} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="hours">{t('working_hours')}</Label>
            <textarea id="hours" rows={3} className={textarea} value={form.working_hours} onChange={(e) => set('working_hours', e.target.value)} placeholder={t('working_hours_ph')} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('location')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted">{t('location_hint')}</p>
          <LocationPicker
            lat={form.latitude}
            lng={form.longitude}
            onChange={(lat, lng) => setForm((f) => ({ ...f, latitude: lat, longitude: lng }))}
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="lat">{t('latitude')}</Label>
              <Input id="lat" dir="ltr" className="num" inputMode="decimal" value={form.latitude ?? ''}
                onChange={(e) => set('latitude', e.target.value === '' ? null : Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lng">{t('longitude')}</Label>
              <Input id="lng" dir="ltr" className="num" inputMode="decimal" value={form.longitude ?? ''}
                onChange={(e) => set('longitude', e.target.value === '' ? null : Number(e.target.value))} />
            </div>
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

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

interface SalesSettings {
  default_tax_rate: number;
  default_payment_type: string;
  invoice_prefix: string;
  require_return_source: boolean;
  return_window_days: number;
  default_terms: string;
}

/** نطاق عدّاد ICV — إعدادٌ مستقلّ عن بادئات ترقيم المستندات أعلاه. */
interface ZatcaSettingsResponse {
  data: { icv_scope: string };
  meta: { branch_scope_available: boolean; branch_scope_blocker: string | null };
}

interface ZatcaScopeState {
  icv_scope: string;
  branch_available: boolean;
}

export default function InvoiceSettingsPage() {
  const t = useTranslations('salesSettings');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();
  const [form, setForm] = useState<SalesSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [zatca, setZatca] = useState<ZatcaScopeState | null>(null);
  const [savingScope, setSavingScope] = useState(false);

  useEffect(() => {
    api<{ data: SalesSettings }>('/sales-settings').then((r) => setForm(r.data)).catch(() => {});

    api<ZatcaSettingsResponse>('/zatca-settings')
      .then((r) => setZatca({ icv_scope: r.data.icv_scope, branch_available: r.meta.branch_scope_available }))
      .catch(() => {});
  }, []);

  async function saveScope(scope: string) {
    setSavingScope(true);
    setError(null);
    try {
      const r = await api<{ data: { icv_scope: string } }>('/zatca-settings', {
        method: 'PUT',
        body: { icv_scope: scope },
      });
      setZatca((z) => (z ? { ...z, icv_scope: r.data.icv_scope } : z));
      success(tc('updated'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSavingScope(false);
    }
  }

  const set = <K extends keyof SalesSettings>(k: K, v: SalesSettings[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      await api('/sales-settings', {
        method: 'PUT',
        body: {
          default_tax_rate: Number(form.default_tax_rate) || 0,
          default_payment_type: form.default_payment_type,
          require_return_source: form.require_return_source,
          return_window_days: form.return_window_days,
          default_terms: form.default_terms || null,
        },
      });
      success(tc('updated'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/sales-settings')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="text-xl font-semibold text-text">{t('invoices_title')}</h1>
      </div>

      <Card className="max-w-2xl">
        <CardHeader><CardTitle>{t('c_invoices_t')}</CardTitle></CardHeader>
        <CardContent>
          {!form ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rate">{t('default_tax_rate')}</Label>
                  <Input id="rate" className="num text-end" type="number" min={0} max={100} value={form.default_tax_rate} onChange={(e) => set('default_tax_rate', Number(e.target.value))} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pt">{t('default_payment_type')}</Label>
                  <Select id="pt" value={form.default_payment_type} onChange={(e) => set('default_payment_type', e.target.value)}>
                    <option value="cash">{t('cash')}</option>
                    <option value="credit">{t('credit')}</option>
                  </Select>
                </div>
                {/* البادئة انتقلت إلى «إعدادات الترقيم المتسلسل» — تُعرَض هنا
                    للاطّلاع مع رابطها، فلا يبحث عنها من اعتادها في هذا الموضع. */}
                <div className="space-y-1.5">
                  <Label>{t('invoice_prefix')}</Label>
                  <p className="num text-sm text-text" dir="ltr">{form.invoice_prefix || 'INV'}</p>
                  <p className="text-xs leading-relaxed text-muted">
                    {t('prefix_moved')}{' '}
                    <Link href="/numbering-settings" className="text-primary hover:underline">{t('prefix_moved_link')}</Link>
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="require-source">{t('require_return_source')}</Label>
                  <Select
                    id="require-source" value={form.require_return_source ? '1' : '0'}
                    onChange={(e) => set('require_return_source', e.target.value === '1')}
                  >
                    <option value="0">{t('require_return_source_off')}</option>
                    <option value="1">{t('require_return_source_on')}</option>
                  </Select>
                  <p className="text-xs leading-relaxed text-muted">{t('require_return_source_hint')}</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="return-window">{t('return_window_days')}</Label>
                  <Input
                    id="return-window" className="num text-end" type="number" min={0} max={3650}
                    value={form.return_window_days}
                    onChange={(e) => set('return_window_days', Number(e.target.value) || 0)}
                  />
                  <p className="text-xs leading-relaxed text-muted">{t('return_window_days_hint')}</p>
                </div>
              </div>
              {/* الشروط المطبوعة على المستند تأتي من «تصميم المستندات» لا من هنا —
                  فالتلميح يوجّه إليها بدل أن يترك الحقل يَعِد بما لا يفعل. */}
              <div className="space-y-1.5">
                <Label htmlFor="terms">{t('default_terms')}</Label>
                <Input id="terms" value={form.default_terms} onChange={(e) => set('default_terms', e.target.value)} />
                <p className="text-xs text-muted">
                  {t('default_terms_hint')}{' '}
                  <Link href="/sales-settings/designs" className="text-primary hover:underline">{t('designs_link')}</Link>
                </p>
              </div>

              {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={saving}>{t('save')}</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {/* بطاقة منفصلة عمداً: عدّاد ZATCA ليس رقم مستند، وجمعُه مع البادئات
          أعلاه هو مصدر الالتباس الذي تقطعه هذه الشاشة. */}
      <Card className="max-w-2xl">
        <CardHeader><CardTitle>{t('c_zatca_icv_t')}</CardTitle></CardHeader>
        <CardContent>
          {!zatca ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="icv-scope">{t('icv_scope')}</Label>
                <Select
                  id="icv-scope"
                  value={zatca.icv_scope}
                  disabled={!zatca.branch_available || savingScope}
                  onChange={(e) => saveScope(e.target.value)}
                >
                  <option value="tenant">{t('icv_scope_tenant')}</option>
                  <option value="branch">{t('icv_scope_branch')}</option>
                </Select>
                <p className="text-xs leading-relaxed text-muted">{t('icv_scope_hint')}</p>
              </div>

              {/* تحذيران مختلفان: تعذُّرٌ حين يكون الخيار معطَّلاً، وتنبيهٌ دائم
                  حين يصير متاحاً — فالخطر لا يزول بإتاحته. */}
              <p className="rounded bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
                {zatca.branch_available ? t('icv_scope_warning') : t('icv_scope_unavailable')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

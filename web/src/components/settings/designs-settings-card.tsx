'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { InvoiceDocument } from '@/components/invoices/invoice-document';
import { api } from '@/lib/api';
import { listTemplates } from '@/modules/documents/registry/templates';
import { THEME_IDS, themeSwatch } from '@/modules/documents/themes';
import type { ThemeId } from '@/modules/documents/types';

/** شكل إعداد التصاميم المخزَّن (sales-config/designs). */
interface DesignsConfig {
  template: string;
  theme: ThemeId;
  show_logo: boolean;
  footer_text: string;
  accent_color?: string;
}

/** بيانات فاتورة عيّنة للمعاينة الحيّة (لا تمسّ أي سجلّ حقيقي). */
const SAMPLE = {
  invoice: {
    number: 'INV-2026-0001',
    invoice_date: '2026-01-01',
    payment_type: 'cash',
    subtotal: '1000.00',
    tax_amount: '150.00',
    total: '1150.00',
    lines: [
      { id: 's1', description: 'خدمة استشارية', quantity: 1, unit_price: '1000.00', tax_rate: 15, line_tax: '150.00', line_total: '1150.00' },
      { id: 's2', description: 'اشتراك سنوي', quantity: 2, unit_price: '250.00', tax_rate: 15, line_tax: '75.00', line_total: '575.00' },
    ],
  },
  company: { name: 'شركتك', vat_number: '300000000000003', cr_number: '1010101010' },
  customer: { name: 'عميل تجريبي', vat_number: '310000000000003', city: 'الرياض' },
};

const DEFAULTS: DesignsConfig = { template: 'classic', theme: 'blue', show_logo: true, footer_text: '', accent_color: '#2563EB' };

/**
 * إعدادات التصاميم/الهوية — اختيار القالب والثيم والشعار والتذييل مع **معاينة حيّة**،
 * وحفظها كافتراضي للمستأجر عبر sales-config/designs (يقرؤها منتقي الفاتورة).
 */
export function DesignsSettingsCard({ canManage }: { canManage: boolean }) {
  const t = useTranslations('designSettings');
  const tt = useTranslations('invoiceTemplates');
  const tc = useTranslations('themeColors');
  const { success, error: errorToast } = useToast();
  const [cfg, setCfg] = useState<DesignsConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<{ data: Partial<DesignsConfig> }>('/sales-config/designs')
      .then((r) => setCfg({ ...DEFAULTS, ...r.data }))
      .catch(() => setCfg(DEFAULTS));
  }, []);

  const patch = (p: Partial<DesignsConfig>) => setCfg((c) => (c ? { ...c, ...p } : c));

  async function save() {
    if (!cfg) return;
    setSaving(true);
    try {
      await api('/sales-config/designs', { method: 'PUT', body: { data: cfg } });
      success(t('saved'));
    } catch {
      errorToast(t('save_failed'));
    } finally {
      setSaving(false);
    }
  }

  // القالب/الثيم المُختاران مطابقان لمعرّفات السجلّ.
  const templateId = cfg ? `tax-invoice-${cfg.template}` : undefined;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('title')}</CardTitle>
        {canManage && cfg && (
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? t('saving') : t('save')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted">{t('hint')}</p>
        {!cfg ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="tpl">{t('template')}</Label>
                <Select id="tpl" value={cfg.template} disabled={!canManage} onChange={(e) => patch({ template: e.target.value })}>
                  {listTemplates().map((d) => (
                    <option key={d.id} value={d.nameKey}>{tt(d.nameKey)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="thm">{t('theme')}</Label>
                <Select id="thm" value={cfg.theme} disabled={!canManage} onChange={(e) => patch({ theme: e.target.value as ThemeId })}>
                  {THEME_IDS.map((id) => (
                    <option key={id} value={id}>{tc(id)}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="logo">{t('show_logo')}</Label>
                <Select id="logo" value={cfg.show_logo ? '1' : '0'} disabled={!canManage} onChange={(e) => patch({ show_logo: e.target.value === '1' })}>
                  <option value="1">{t('yes')}</option>
                  <option value="0">{t('no')}</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ft">{t('footer')}</Label>
                <Input id="ft" value={cfg.footer_text} disabled={!canManage} onChange={(e) => patch({ footer_text: e.target.value })} placeholder={t('footer')} />
              </div>
            </div>

            {/* شريط ألوان الثيم — نقرة سريعة (بديل بصري للقائمة). */}
            <div className="flex flex-wrap items-center gap-2">
              {THEME_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={!canManage}
                  onClick={() => patch({ theme: id })}
                  aria-label={tc(id)}
                  aria-pressed={cfg.theme === id}
                  className={`h-6 w-6 rounded-full ring-offset-2 ring-offset-surface transition disabled:opacity-50 ${cfg.theme === id ? 'ring-2 ring-primary' : 'ring-1 ring-border'}`}
                  style={{ background: themeSwatch(id) }}
                />
              ))}
            </div>

            {/* معاينة حيّة — rootId=null فلا تخطف الطباعة. */}
            <div>
              <div className="mb-2 text-xs font-medium text-muted">{t('preview')}</div>
              <div className="max-h-[560px] overflow-auto rounded-lg border border-border bg-gray-100 p-3 dark:bg-black/30">
                <InvoiceDocument
                  invoice={SAMPLE.invoice}
                  company={SAMPLE.company}
                  customer={SAMPLE.customer}
                  qr={null}
                  templateId={templateId}
                  themeId={cfg.theme}
                  footerText={cfg.footer_text}
                  showLogo={cfg.show_logo}
                  rootId={null}
                />
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

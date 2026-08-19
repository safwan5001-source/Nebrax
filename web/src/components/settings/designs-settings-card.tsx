'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Upload, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { InvoiceDocument } from '@/components/invoices/invoice-document';
import { SectionDesigner } from '@/components/settings/section-designer';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { api } from '@/lib/api';
import { notifyCompanyUpdated } from '@/lib/company';
import { fileToResizedDataUrl } from '@/lib/image';
import { listTemplates } from '@/modules/documents/registry/templates';
import { THEME_IDS, themeSwatch } from '@/modules/documents/themes';
import { DEFAULT_SECTION_ORDER, type ThemeId, type DocSectionLayoutItem } from '@/modules/documents/types';

/** الأقسام المخفيّة افتراضياً (اختيارية — يفعّلها المستخدم من المصمّم). */
const HIDDEN_BY_DEFAULT: ReadonlySet<string> = new Set(['barcode', 'amountWords']);

/** التخطيط الافتراضي للأقسام. */
const DEFAULT_LAYOUT: DocSectionLayoutItem[] = DEFAULT_SECTION_ORDER.map((key) => ({ key, visible: !HIDDEN_BY_DEFAULT.has(key) }));

/** شكل إعداد التصاميم المخزَّن (sales-config/designs). */
interface DesignsConfig {
  template: string;
  theme: ThemeId;
  show_logo: boolean;
  logo: string;        // data URL أو فارغ
  logo_height: number; // بكسل
  footer_text: string;
  terms_text: string;
  bank_text: string;  // بيانات بنكية
  stamp: string;      // صورة الختم (data URL)
  signature: string;  // صورة التوقيع (data URL)
  sections?: DocSectionLayoutItem[]; // تخطيط الأقسام (مصمّم المستند)
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
    notes: 'ملاحظة تجريبية تظهر عند تفعيل قسم الملاحظات.',
    lines: [
      { id: 's1', description: 'خدمة استشارية', quantity: 1, unit_price: '1000.00', tax_rate: 15, line_tax: '150.00', line_total: '1150.00' },
      { id: 's2', description: 'اشتراك سنوي', quantity: 2, unit_price: '250.00', tax_rate: 15, line_tax: '75.00', line_total: '575.00' },
    ],
  },
  company: { name: 'شركتك', vat_number: '300000000000003', cr_number: '1010101010' },
  customer: { name: 'عميل تجريبي', vat_number: '310000000000003', city: 'الرياض' },
};

const DEFAULTS: DesignsConfig = { template: 'classic', theme: 'blue', show_logo: true, logo: '', logo_height: 56, footer_text: '', terms_text: '', bank_text: '', stamp: '', signature: '', accent_color: '#2563EB' };

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
  const fileRef = useRef<HTMLInputElement>(null);
  const stampRef = useRef<HTMLInputElement>(null);
  const signRef = useRef<HTMLInputElement>(null);

  /** يرفع صورة (شعار/ختم/توقيع) ويحفظها كـ data URL مصغّر في المفتاح المعطى. */
  async function onPickImage(file: File | undefined, key: 'logo' | 'stamp' | 'signature') {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      errorToast(t('logo_invalid'));
      return;
    }
    try {
      const dataUrl = await fileToResizedDataUrl(file, 320);
      patch({ [key]: dataUrl });
    } catch {
      errorToast(t('logo_invalid'));
    }
  }

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
      // يحدّث /me الشعار من إعدادات المؤسسة؛ تُعيد القشرة قراءته فور الحفظ.
      notifyCompanyUpdated();
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

            {/* شعار الشركة: رفع + معاينة مصغّرة + إزالة + ضبط المقاس. */}
            <div className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-background">
                  {cfg.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- data URL
                    <img src={cfg.logo} alt="logo" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <span className="text-[10px] text-muted">{t('no_logo')}</span>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => { void onPickImage(e.target.files?.[0], 'logo'); e.target.value = ''; }}
                    />
                    <Button variant="outline" size="sm" disabled={!canManage} onClick={() => fileRef.current?.click()}>
                      <Upload className="h-4 w-4" strokeWidth={1.7} />
                      {t('logo_upload')}
                    </Button>
                    {cfg.logo && (
                      <Button variant="ghost" size="sm" disabled={!canManage} onClick={() => patch({ logo: '' })}>
                        <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
                        {t('remove_logo')}
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] text-muted">{t('logo_hint')}</p>
                </div>
                <div className="ms-auto flex items-center gap-2">
                  <Label htmlFor="lh" className="text-xs text-muted">{t('logo_size')}</Label>
                  <input
                    id="lh"
                    type="range"
                    min={24}
                    max={96}
                    step={4}
                    disabled={!canManage || !cfg.logo}
                    value={cfg.logo_height}
                    onChange={(e) => patch({ logo_height: Number(e.target.value) })}
                    className="w-32 accent-primary disabled:opacity-50"
                  />
                  <span className="num w-10 text-xs text-text">{cfg.logo_height}px</span>
                </div>
              </div>
            </div>

            {/* الشروط والأحكام — نصّ يظهر في المستند عند تفعيل قسمه في المصمّم. */}
            <div className="space-y-1.5">
              <Label htmlFor="terms">{t('terms')}</Label>
              <textarea
                id="terms"
                rows={2}
                disabled={!canManage}
                value={cfg.terms_text}
                onChange={(e) => patch({ terms_text: e.target.value })}
                className="min-h-16 w-full resize-y rounded border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                placeholder={t('terms')}
              />
            </div>

            {/* البيانات البنكية — نصّ يظهر في المستند عند تفعيل قسمه في المصمّم. */}
            <div className="space-y-1.5">
              <Label htmlFor="bank">{t('bank')}</Label>
              <textarea
                id="bank"
                rows={2}
                disabled={!canManage}
                value={cfg.bank_text}
                onChange={(e) => patch({ bank_text: e.target.value })}
                className="min-h-16 w-full resize-y rounded border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                placeholder={t('bank_placeholder')}
              />
            </div>

            {/* الختم والتوقيع — صور تظهر عند تفعيل قسميهما في المصمّم. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {([
                // نصّ الزرّ لكل كتلة على حدة — كان الثلاثة يقولون «رفع شعار»
                // بخطأ نسخ، فيظنّ المستخدم أنه يستبدل الشعار وهو يرفع ختماً.
                { key: 'stamp' as const, ref: stampRef, label: t('stamp'), hint: t('stamp_hint'), upload: t('stamp_upload') },
                { key: 'signature' as const, ref: signRef, label: t('signature'), hint: t('signature_hint'), upload: t('signature_upload') },
              ]).map((img) => (
                <div key={img.key} className="rounded-lg border border-border p-3">
                  <div className="mb-2 text-xs font-medium text-muted">{img.label}</div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-background">
                      {cfg[img.key] ? (
                        // eslint-disable-next-line @next/next/no-img-element -- data URL
                        <img src={cfg[img.key]} alt={img.key} className="max-h-full max-w-full object-contain" />
                      ) : (
                        <span className="text-[10px] text-muted">{img.hint}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        ref={img.ref}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => { void onPickImage(e.target.files?.[0], img.key); e.target.value = ''; }}
                      />
                      <Button variant="outline" size="sm" disabled={!canManage} onClick={() => img.ref.current?.click()}>
                        <Upload className="h-4 w-4" strokeWidth={1.7} />
                        {img.upload}
                      </Button>
                      {cfg[img.key] && (
                        <Button variant="ghost" size="sm" disabled={!canManage} onClick={() => patch({ [img.key]: '' })}>
                          <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
                          {t('remove_logo')}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* مصمّم الأقسام: سحب لإعادة الترتيب + إظهار/إخفاء (dnd-kit). */}
            <div className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-medium text-muted">{t('layout_title')}</div>
                {canManage && cfg.sections && (
                  <Button variant="ghost" size="sm" onClick={() => patch({ sections: undefined })}>{t('layout_reset')}</Button>
                )}
              </div>
              <SectionDesigner value={cfg.sections ?? DEFAULT_LAYOUT} onChange={(v) => patch({ sections: v })} disabled={!canManage} />
            </div>

            {/* معاينة حيّة — rootId=null فلا تخطف الطباعة. */}
            <div>
              <div className="mb-2 text-xs font-medium text-muted">{t('preview')}</div>
              <div className="max-h-[600px] overflow-auto rounded-lg border border-border bg-gray-100 p-3 dark:bg-black/30">
                <DocumentScaler>
                  <InvoiceDocument
                    invoice={SAMPLE.invoice}
                    company={SAMPLE.company}
                    customer={SAMPLE.customer}
                    qr={null}
                    templateId={templateId}
                    themeId={cfg.theme}
                    footerText={cfg.footer_text}
                    terms={cfg.terms_text}
                    bank={cfg.bank_text}
                    stampUrl={cfg.stamp}
                    signatureUrl={cfg.signature}
                    showLogo={cfg.show_logo}
                    logoUrl={cfg.logo}
                    logoHeight={cfg.logo_height}
                    layout={cfg.sections ?? DEFAULT_LAYOUT}
                    rootId={null}
                  />
                </DocumentScaler>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Printer, Download, Share2, LayoutTemplate, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { useToast } from '@/components/ui/toast';
import {
  PaymentDocument,
  type PaymentDoc,
  type PaymentCompany,
  type PaymentPartner,
} from '@/components/payments/payment-document';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { printDocument } from '@/modules/documents/services/export';
import { createPaymentPdf, downloadPaymentPdf, sharePaymentPdf } from '@/modules/payments/services/payment-pdf';
import { getTemplate, listTemplates, DEFAULT_TEMPLATE_ID } from '@/modules/documents/registry/templates';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import type { ThemeId } from '@/modules/documents/types';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import { resolveFrozenOutputDefinition } from '@/modules/print-templates/services/frozen-output-template';
import { resolveLiveTemplateDefinition, type LivePrintTemplateAssignment } from '@/modules/print-templates/services/live-template-definition';

/** دفعة من الـ API — أرقام بالريال نصّاً. */
interface FrozenPrintTemplateRevision {
  id: string;
  version: number;
  definition: { template_id?: string; theme_id?: ThemeId; footer_text?: string; show_logo?: boolean };
  document_types: string[];
}

interface Payment extends PaymentDoc {
  id: string;
  branch_id: string | null;
  partner_id: string;
  status: string;
  print_template_revision_id?: string | null;
  print_template_revision?: FrozenPrintTemplateRevision | null;
  pdf_template_revision_id?: string | null;
  pdf_template_revision?: FrozenPrintTemplateRevision | null;
  thermal_template_revision_id?: string | null;
  thermal_template_revision?: FrozenPrintTemplateRevision | null;
}

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = {
  posted: 'positive',
  draft: 'muted',
  cancelled: 'negative',
};

export default function PaymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('paymentDetail');
  const tp = useTranslations('payments');
  const ts = useTranslations('status');
  const tt = useTranslations('invoiceTemplates');
  const tPrint = useTranslations('documentPrint');
  const locale = useLocale();
  const { success, error: errorToast } = useToast();

  const [payment, setPayment] = useState<Payment | null>(null);
  const [partner, setPartner] = useState<PaymentPartner | null>(null);
  const [company, setCompany] = useState<PaymentCompany | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<null | 'pdf' | 'share'>(null);
  const [templateId, setTemplateId] = useState<string>(DEFAULT_TEMPLATE_ID);
  const [themeId, setThemeId] = useState<ThemeId | null>(null);
  const [footerText, setFooterText] = useState<string | null>(null);
  const [showLogo, setShowLogo] = useState(true);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoHeight, setLogoHeight] = useState<number | null>(null);
  const [bankText, setBankText] = useState<string | null>(null);
  const [stampUrl, setStampUrl] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);

  // طريقة الدفع تُترجَم قبل بناء النموذج (المحرّك يستهلك نصّاً جاهزاً).
  const partnerName = partner?.name ?? '—';

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    api<{ data: Payment }>(`/payments/${id}`)
      .then(async (r) => {
        setPayment(r.data);
        const documentType = r.data.direction === 'received' ? 'receipt_voucher' : 'payment_voucher';
        const branchQuery = r.data.branch_id ? `&branch_id=${encodeURIComponent(r.data.branch_id)}` : '';
        const [p, m, legacy, live] = await Promise.allSettled([
          api<{ data: PaymentPartner }>(`/partners/${r.data.partner_id}`),
          api<{ company: PaymentCompany }>(`/me`),
          api<{ data: { template?: string; theme?: string; footer_text?: string; show_logo?: boolean; logo?: string; logo_height?: number; bank_text?: string; stamp?: string; signature?: string } }>(`/sales-config/designs`),
          api<{ data: LivePrintTemplateAssignment | null }>(`/print-templates/resolve?document_type=${documentType}&usage=print${branchQuery}`),
        ]);
        if (p.status === 'fulfilled') setPartner(p.value.data);
        if (m.status === 'fulfilled') setCompany(m.value.company);
        // السند المرحّل يقرأ مراجعته المثبتة حصراً؛ لا يعيد تعديل القالب أو
        // إعدادات التصميم الحية تفسير مستند تاريخي. المسودات والبيانات القديمة
        // تستخدم إعدادات التوافق الحية إلى أن تُرحّل.
        const frozen = r.data.print_template_revision?.definition;
        if (frozen) {
          setTemplateId(getTemplate(frozen.template_id ?? DEFAULT_TEMPLATE_ID).id);
          setThemeId(frozen.theme_id ?? null);
          setFooterText(frozen.footer_text ?? null);
          setShowLogo(frozen.show_logo !== false);
          setLogoUrl(null);
          setLogoHeight(null);
          setBankText(null);
          setStampUrl(null);
          setSignatureUrl(null);
        } else {
          const resolved = live.status === 'fulfilled'
            ? resolveLiveTemplateDefinition(live.value.data, documentType)
            : null;
          if (resolved) {
            setTemplateId(resolved.templateId);
            setThemeId(resolved.themeId);
            setFooterText(resolved.footerText);
            setShowLogo(resolved.showLogo);
            setLogoUrl(null);
            setLogoHeight(null);
            setBankText(resolved.bankText);
            setStampUrl(null);
            setSignatureUrl(null);
          } else if (legacy.status === 'fulfilled') {
            // التوافق صريح: تعريف الهجرة القديم أو غياب تعيين حي لا يفسران جزئياً.
            const dg = legacy.value.data ?? {};
            setTemplateId(getTemplate(`tax-invoice-${dg.template ?? ''}`).id);
            if (dg.theme) setThemeId(dg.theme as ThemeId);
            setFooterText(dg.footer_text ?? null);
            setShowLogo(dg.show_logo !== false);
            setLogoUrl(dg.logo ?? null);
            setLogoHeight(dg.logo_height ?? null);
            setBankText(dg.bank_text ?? null);
            setStampUrl(dg.stamp ?? null);
            setSignatureUrl(dg.signature ?? null);
          }
        }
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => load(), [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded border border-border bg-surface p-8 text-center">
        <p className="text-sm text-negative">{t('load_error')}</p>
        <Button variant="outline" className="mt-3" onClick={load}>{t('retry')}</Button>
      </div>
    );
  }

  if (!payment) {
    return <div className="text-muted">{t('not_found')}</div>;
  }

  // طريقة الدفع مترجَمة، وتُمرَّر للمستند كنصّ جاهز.
  const methodLabel = payment.method === 'bank' ? tp('bank') : tp('cash');
  const paymentDoc: PaymentDoc = { ...payment, method: methodLabel };

  const info: [string, React.ReactNode][] = [
    [tp('partner'), partnerName],
    [tp('date'), <span key="d" className="num">{payment.payment_date}</span>],
    [tp('direction'), payment.direction === 'received' ? tp('received') : tp('paid')],
    [tp('method'), methodLabel],
    [tp('amount'), <span key="a" className="num font-semibold">{formatRiyal(payment.amount)}</span>],
  ];

  const paperId = getTemplate(templateId).supportedPaper[0] ?? 'a4';
  const paper = { widthMm: PAPER_SIZES[paperId].widthMm, heightMm: PAPER_SIZES[paperId].heightMm };
  const frozenPdfDefinition = resolveFrozenOutputDefinition(
    payment.pdf_template_revision,
    payment.print_template_revision,
  );
  const frozenThermalDefinition = payment.thermal_template_revision?.definition ?? null;
  const thermalTemplateId = frozenThermalDefinition?.template_id ?? null;
  const thermalPaperId = thermalTemplateId
    ? getTemplate(thermalTemplateId).supportedPaper.find((candidate) => candidate.startsWith('thermal_'))
    : null;
  const thermalPaper = thermalPaperId
    ? { widthMm: PAPER_SIZES[thermalPaperId].widthMm, heightMm: PAPER_SIZES[thermalPaperId].heightMm }
    : null;

  async function createPdf() {
    if (!payment) throw new Error('Payment unavailable');
    return createPaymentPdf({
      payment,
      company,
      partner,
      logoUrl,
      footerText: frozenPdfDefinition?.footer_text ?? footerText,
      labels: {
        receiptTitle: t('receipt_title'),
        paymentTitle: t('payment_title'),
        receiptSubtitle: t('receipt_subtitle'),
        paymentSubtitle: t('payment_subtitle'),
        company: tPrint('seller'),
        customer: t('customer'),
        supplier: t('supplier'),
        voucherNumber: t('voucher_number'),
        date: tp('date'),
        method: tp('method'),
        reference: t('reference'),
        status: tp('status'),
        amount: t('amount'),
        allocations: t('allocations'),
        onAccount: t('on_account'),
        notes: t('notes'),
        cash: tp('cash'),
        bank: tp('bank'),
        vatNumber: tPrint('vat_number'),
        crNumber: tPrint('cr_number'),
        description: tPrint('description'),
        total: tPrint('total'),
        footer: tPrint('footer'),
      },
      locale,
    });
  }

  async function handleDownloadPdf() {
    if (!payment) return;
    setBusy('pdf');
    try {
      downloadPaymentPdf(await createPdf(), payment.number);
      success(tPrint('downloaded_ok'));
    } catch {
      errorToast(tPrint('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleShare() {
    if (!payment) return;
    setBusy('share');
    try {
      const result = await sharePaymentPdf(await createPdf(), payment.number, payment.direction === 'received' ? t('receipt_title') : t('payment_title'));
      success(result === 'shared' ? tPrint('shared_ok') : tPrint('downloaded_ok'));
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') errorToast(tPrint('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" className="no-print" onClick={() => router.push('/payments')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="num text-xl font-semibold text-text">{payment.number}</h1>
        <Badge tone={payment.direction === 'received' ? 'positive' : 'warning'}>
          {payment.direction === 'received' ? tp('received') : tp('paid')}
        </Badge>
        <Badge tone={statusTone[payment.status] ?? 'muted'}>{ts(payment.status)}</Badge>
        <div className="no-print ms-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={!!busy}>
            <Download className="h-4 w-4" strokeWidth={1.7} />
            {busy === 'pdf' ? t('generating') : t('download_pdf')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleShare} disabled={!!busy}>
            <Share2 className="h-4 w-4" strokeWidth={1.7} />
            {busy === 'share' ? t('generating') : t('share')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => printDocument(paper, 'print-root')} disabled={!!busy}>
            <Printer className="h-4 w-4" strokeWidth={1.7} />
            {t('print')}
          </Button>
          {frozenThermalDefinition && thermalPaper && thermalTemplateId && (
            <Button variant="outline" size="sm" onClick={() => printDocument(thermalPaper, 'thermal-print-root')} disabled={!!busy}>
              <Printer className="h-4 w-4" strokeWidth={1.7} />
              {tPrint('thermal_print')}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('details')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {info.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="text-text">{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {/* معاينة السند A4 (مرئية على الشاشة + مصدر الطباعة/الـ PDF) */}
      <Card>
        <CardHeader className="no-print flex flex-row items-center justify-between gap-3">
          <CardTitle>{t('preview')}</CardTitle>
          {payment.print_template_revision ? (
            <div className="flex min-w-0 items-center gap-2 text-sm text-text">
              <LayoutTemplate className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
              <span className="truncate">{tt(getTemplate(templateId).nameKey)}</span>
              <Badge tone="muted" className="shrink-0 whitespace-nowrap">{t('frozen_template')}</Badge>
            </div>
          ) : (
            <Dropdown
              align="end"
              menuLabel={t('template')}
              triggerClassName="h-8 gap-2 border border-border px-3 text-sm text-text hover:bg-primary-soft"
              trigger={
                <>
                  <LayoutTemplate className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
                  <span>{tt(getTemplate(templateId).nameKey)}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={1.8} />
                </>
              }
            >
              {listTemplates().map((d) => (
                <DropdownItem key={d.id} onClick={() => setTemplateId(d.id)}>
                  {tt(d.nameKey)}
                </DropdownItem>
              ))}
            </Dropdown>
          )}
        </CardHeader>
        <CardContent className="print:p-0">
          <div className="rounded-lg bg-gray-100 p-3 dark:bg-black/30 print:bg-transparent print:p-0">
            <DocumentScaler>
              <PaymentDocument
                payment={paymentDoc}
                company={company}
                partner={partner}
                templateId={templateId}
                themeId={themeId}
                footerText={footerText}
                bank={bankText}
                stampUrl={stampUrl}
                signatureUrl={signatureUrl}
                showLogo={showLogo}
                logoUrl={logoUrl}
                logoHeight={logoHeight}
              />
            </DocumentScaler>
          </div>
        </CardContent>
      </Card>

      {frozenThermalDefinition && thermalPaper && thermalTemplateId && (
        <PaymentDocument
          payment={paymentDoc}
          company={company}
          partner={partner}
          templateId={thermalTemplateId}
          themeId={frozenThermalDefinition.theme_id ?? null}
          footerText={frozenThermalDefinition.footer_text ?? null}
          showLogo={frozenThermalDefinition.show_logo !== false}
          rootId="thermal-print-root"
        />
      )}
    </div>
  );
}

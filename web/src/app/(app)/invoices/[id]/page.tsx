'use client';
import { formatDateTime } from '@/lib/formatting';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowRight, Banknote, BookOpen, Boxes, CheckCircle2, ChevronDown, Copy, Download, Paperclip,
  FileSpreadsheet, LayoutTemplate, MoreVertical, Pencil, Printer,
  RotateCcw, Share2, Trash2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog } from '@/components/ui/dialog';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import { Accordion, AccordionItem } from '@/components/ui/accordion';
import { EmptyState } from '@/components/nebrax';
import { useToast } from '@/components/ui/toast';
import { InvoiceDocument, type Company, type Customer } from '@/components/invoices/invoice-document';
import { CreateReturnDialog } from '@/components/returns/create-return-dialog';
import { InvoiceNoteDialog } from '@/components/invoices/invoice-note-dialog';
import { api, downloadFile } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { documentExporter, printDocument } from '@/modules/documents/services/export';
import { getTemplate, listTemplates, DEFAULT_TEMPLATE_ID } from '@/modules/documents/registry/templates';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { RevisionLog } from '@/components/documents/revision-log';
import type { ThemeId, DocSectionLayoutItem } from '@/modules/documents/types';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import { exportXlsx } from '@/lib/xlsx';
import type { LivePrintTemplateAssignment, ResolvedLiveTemplate } from '@/modules/print-templates/services/live-template-definition';
import {
  invoiceCatalogDocumentType,
  resolveDocumentOutputTemplates,
  thermalPaperForTemplate,
} from '@/modules/print-templates/services/document-output-template';

interface Line {
  id: string;
  product_name: string | null;
  product_code: string | null;
  barcode: string | null;
  description: string | null;
  quantity: number;
  unit_price: string;
  unit_price_before_tax: string;
  tax_rate: number;
  line_subtotal: string;
  line_tax: string;
  line_total: string;
  minimum_price_override?: { reason: string; approved_by_user_id: string } | null;
}
interface FrozenPrintTemplateRevision {
  id: string;
  version: number;
  definition: {
    template_id?: string;
    theme_id?: ThemeId;
    footer_text?: string;
    show_logo?: boolean;
    layout?: DocSectionLayoutItem[];
    terms_text?: string;
    bank_text?: string;
    stamp?: string;
    signature?: string;
    logo_height?: number;
  };
  document_types: string[];
}
interface Invoice {
  id: string;
  branch_id: string | null;
  number: string;
  partner_id: string;
  payment_type: string;
  status: string;
  payment_status: string;
  invoice_date: string;
  due_date: string | null;
  subtotal: string;
  discount: string;
  shipping: string;
  adjustment: string;
  tax_amount: string;
  total: string;
  paid_amount: string;
  remaining: string;
  notes: string | null;
  zatca_document_type?: string | null;
  cost_center?: { id: string; code: string; name: string } | null;
  lines: Line[];
  print_template_revision_id?: string | null;
  print_template_revision?: FrozenPrintTemplateRevision | null;
  pdf_template_revision_id?: string | null;
  pdf_template_revision?: FrozenPrintTemplateRevision | null;
  thermal_template_revision_id?: string | null;
  thermal_template_revision?: FrozenPrintTemplateRevision | null;
}
interface InvoicePayment {
  id: string;
  number: string;
  payment_date: string | null;
  method: 'cash' | 'bank';
  status: string;
  amount: string;
  allocated_amount: string;
}
interface AccountingEntry {
  id: string;
  number: string;
  date: string | null;
  status: string;
  description: string | null;
  lines: { account_id: string; account_code: string | null; account_name: string | null; description: string | null; debit: string; credit: string }[];
}
interface AccountingLinks {
  sales_entry: AccountingEntry | null;
  cost_entry: AccountingEntry | null;
}
interface InvoiceNote {
  id: string;
  recorded_at: string | null;
  body: string | null;
  attachments: { id: string; original_name: string; mime_type: string | null; size: number }[];
}
interface InvoiceInventoryMovement {
  id: string;
  type: 'in' | 'out' | 'adjustment';
  movement_date: string | null;
  quantity: number;
  unit_cost: string;
  total_cost: string;
  balance_quantity: number;
  notes: string | null;
  product: { id: string; sku: string | null; name: string; unit: string | null } | null;
  warehouse: { id: string; code: string; name: string } | null;
}
interface Zatca {
  qr: string | null;
  hash: string | null;
  uuid: string | null;
  icv: number | null;
}
type PendingAction = 'post' | 'delete' | null;
type ExportBusy = 'pdf' | 'share' | 'excel' | null;
type RelationSection = 'payments' | 'notes' | 'inventory' | 'accounting';

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = {
  posted: 'positive',
  draft: 'muted',
  cancelled: 'negative',
};
const payTone: Record<string, 'positive' | 'warning' | 'muted'> = {
  paid: 'positive',
  partial: 'warning',
  unpaid: 'muted',
};

const PAGE_TEMPLATES = listTemplates().filter((definition) => (
  !definition.supportedPaper.some((paper) => paper.startsWith('thermal_'))
));

function liveAssignment(result: PromiseSettledResult<unknown>): LivePrintTemplateAssignment | null {
  if (result.status !== 'fulfilled' || !result.value || typeof result.value !== 'object') return null;
  const data = (result.value as { data?: LivePrintTemplateAssignment | null }).data;
  return data ?? null;
}

function documentPropsFromResolved(resolved: ResolvedLiveTemplate) {
  return {
    templateId: resolved.templateId,
    themeId: resolved.themeId,
    footerText: resolved.footerText,
    terms: resolved.termsText,
    bank: resolved.bankText,
    stampUrl: resolved.stampUrl,
    signatureUrl: resolved.signatureUrl,
    showLogo: resolved.showLogo,
    logoHeight: resolved.logoHeight,
    layout: resolved.layout,
  };
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('invoiceDetail');
  const ti = useTranslations('invoices');
  const ts = useTranslations('status');
  const tPrint = useTranslations('documentPrint');
  const locale = useLocale();
  const { success, error: errorToast } = useToast();

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [zatca, setZatca] = useState<Zatca | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<ExportBusy>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actioning, setActioning] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [notesLog, setNotesLog] = useState<InvoiceNote[]>([]);
  const [inventoryMovements, setInventoryMovements] = useState<InvoiceInventoryMovement[]>([]);
  const [payments, setPayments] = useState<InvoicePayment[]>([]);
  const [accounting, setAccounting] = useState<AccountingLinks | null>(null);
  const [relationsLoading, setRelationsLoading] = useState(true);
  const [relationsUnavailable, setRelationsUnavailable] = useState(false);
  const [relationSection, setRelationSection] = useState<RelationSection | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [financialOpen, setFinancialOpen] = useState(false);
  const [documentOpen, setDocumentOpen] = useState(true);
  const [templateId, setTemplateId] = useState<string>(DEFAULT_TEMPLATE_ID);
  const [themeId, setThemeId] = useState<ThemeId | null>(null);
  const [footerText, setFooterText] = useState<string | null>(null);
  const [showLogo, setShowLogo] = useState(true);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoHeight, setLogoHeight] = useState<number | null>(null);
  const [layout, setLayout] = useState<DocSectionLayoutItem[] | null>(null);
  const [termsText, setTermsText] = useState<string | null>(null);
  const [bankText, setBankText] = useState<string | null>(null);
  const [stampUrl, setStampUrl] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [pdfOutput, setPdfOutput] = useState<ResolvedLiveTemplate | null>(null);
  const [thermalOutput, setThermalOutput] = useState<ResolvedLiveTemplate | null>(null);
  const [pdfSharesPrintRoot, setPdfSharesPrintRoot] = useState(true);
  const [printLocked, setPrintLocked] = useState(false);
  const tt = useTranslations('invoiceTemplates');

  const partnerName = customer?.name ?? '—';
  const isDraft = invoice?.status === 'draft';
  const isPosted = invoice?.status === 'posted';
  const canCollect = isPosted && invoice?.payment_status !== 'paid';
  const priceOverrides = invoice?.lines.filter((line) => !!line.minimum_price_override?.reason) ?? [];

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    setRelationsLoading(true);
    setRelationsUnavailable(false);
    api<{ data: Invoice }>(`/invoices/${id}`)
      .then(async (r) => {
        setInvoice(r.data);
        const branchQuery = r.data.branch_id ? `&branch_id=${encodeURIComponent(r.data.branch_id)}` : '';
        const catalogType = invoiceCatalogDocumentType(r.data.zatca_document_type);
        const posted = r.data.status !== 'draft';
        const skipped = Promise.resolve({ data: null as LivePrintTemplateAssignment | null });
        const resolveUsage = (documentType: string, usage: 'print' | 'pdf' | 'thermal') => (
          api<{ data: LivePrintTemplateAssignment | null }>(
            `/print-templates/resolve?document_type=${documentType}&usage=${usage}${branchQuery}`,
          )
        );
        const [p, z, m, livePrint, livePdf, liveThermal, fallbackPrint, fallbackPdf, fallbackThermal, paymentRelations, noteRelations, inventoryRelations, accountingRelations] = await Promise.allSettled([
          api<{ data: Customer }>(`/partners/${r.data.partner_id}`),
          api<Zatca>(`/invoices/${id}/zatca`),
          api<{ company: Company }>(`/me`),
          posted ? skipped : resolveUsage(catalogType, 'print'),
          posted ? skipped : resolveUsage(catalogType, 'pdf'),
          posted ? skipped : resolveUsage(catalogType, 'thermal'),
          posted || catalogType !== 'simplified_tax_invoice' ? skipped : resolveUsage('tax_invoice', 'print'),
          posted || catalogType !== 'simplified_tax_invoice' ? skipped : resolveUsage('tax_invoice', 'pdf'),
          posted || catalogType !== 'simplified_tax_invoice' ? skipped : resolveUsage('tax_invoice', 'thermal'),
          api<{ data: InvoicePayment[] }>(`/invoices/${id}/payments`),
          api<{ data: InvoiceNote[] }>(`/invoices/${id}/notes`),
          api<{ data: InvoiceInventoryMovement[] }>(`/invoices/${id}/inventory`),
          api<{ data: AccountingLinks }>(`/invoices/${id}/accounting`),
        ]);
        if (p.status === 'fulfilled') setCustomer(p.value.data);
        if (z.status === 'fulfilled') setZatca(z.value);
        if (m.status === 'fulfilled') setCompany(m.value.company);
        if (paymentRelations.status === 'fulfilled') setPayments(paymentRelations.value.data);
        if (noteRelations.status === 'fulfilled') setNotesLog(noteRelations.value.data);
        if (inventoryRelations.status === 'fulfilled') setInventoryMovements(inventoryRelations.value.data);
        if (accountingRelations.status === 'fulfilled') setAccounting(accountingRelations.value.data);
        setRelationsUnavailable(paymentRelations.status === 'rejected' || noteRelations.status === 'rejected' || inventoryRelations.status === 'rejected' || accountingRelations.status === 'rejected');
        setRelationsLoading(false);

        // الفاتورة المرحّلة تقرأ مراجعتها المثبّتة حصراً؛ لا يعيد تعديل القالب أو
        // إعدادات الهوية تفسير مستند تاريخي. المسودات تستخدم التعيين الحي لكل
        // usage حتى لحظة الترحيل.
        const outputs = resolveDocumentOutputTemplates({
          documentType: catalogType,
          isPosted: posted,
          frozenPrint: r.data.print_template_revision,
          frozenPdf: r.data.pdf_template_revision,
          frozenThermal: r.data.thermal_template_revision,
          livePrint: liveAssignment(livePrint),
          livePdf: liveAssignment(livePdf),
          liveThermal: liveAssignment(liveThermal),
          fallbackLivePrint: liveAssignment(fallbackPrint),
          fallbackLivePdf: liveAssignment(fallbackPdf),
          fallbackLiveThermal: liveAssignment(fallbackThermal),
        });
        const resolved = outputs.print;
        if (resolved) {
          setTemplateId(resolved.templateId);
          setThemeId(resolved.themeId);
          setFooterText(resolved.footerText);
          setShowLogo(resolved.showLogo);
          setLayout(resolved.layout);
          setLogoUrl(null);
          setLogoHeight(resolved.logoHeight);
          setTermsText(resolved.termsText);
          setBankText(resolved.bankText);
          setStampUrl(resolved.stampUrl);
          setSignatureUrl(resolved.signatureUrl);
        } else {
          setTemplateId(DEFAULT_TEMPLATE_ID);
          setThemeId(null);
          setFooterText(null);
          setShowLogo(true);
          setLayout(null);
          setLogoUrl(null);
          setLogoHeight(null);
          setTermsText(null);
          setBankText(null);
          setStampUrl(null);
          setSignatureUrl(null);
        }
        setPdfOutput(outputs.pdf);
        setThermalOutput(outputs.thermal);
        setPdfSharesPrintRoot(outputs.pdfSharesPrintRoot);
        setPrintLocked(posted || resolved !== null);
      })
      .catch(() => setLoadError(true)) // فشل التحميل ≠ سجل غير موجود (تمييز الخطأ عن الغياب)
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

  // نصٌّ عارٍ بلا طريق رجوع كان يترك المستخدم عالقاً. باقي الصفحة **مساحة عمل
  // مستندية** خارج نطاق المرحلة (طباعة وتصدير وZATCA) ولم يُمَسّ منها شيء.
  if (!invoice) {
    return (
      <EmptyState
        title={t('not_found')}
        action={<Button asChild variant="outline"><Link href="/invoices">{t('back')}</Link></Button>}
      />
    );
  }

  const info: [string, React.ReactNode][] = [
    [t('partner'), customer ? <Link href={`/partners/${invoice.partner_id}`} className="text-primary hover:underline">{partnerName}</Link> : partnerName],
    [t('date'), <span key="date" className="num">{invoice.invoice_date}</span>],
    [t('due_date'), <span key="due" className="num">{invoice.due_date ?? '—'}</span>],
    [t('payment_type'), invoice.payment_type === 'cash' ? t('cash') : t('credit')],
    [t('paid'), <span key="paid" className="num font-medium">{formatRiyal(invoice.paid_amount)}</span>],
    [t('remaining'), <span key="remaining" className="num font-semibold">{formatRiyal(invoice.remaining)}</span>],
    [t('cost_center'), invoice.cost_center ? <span key="cost-center" className="text-primary">{invoice.cost_center.code} · {invoice.cost_center.name}</span> : t('not_assigned')],
  ];
  const financialSummary: [string, string, boolean][] = [
    [t('subtotal'), invoice.subtotal, false],
    [t('discount'), invoice.discount, false],
    [t('shipping'), invoice.shipping, false],
    [t('adjustment'), invoice.adjustment, false],
    [t('tax_amount'), invoice.tax_amount, false],
    [t('grand_total'), invoice.total, true],
  ];

  const relationTabs = [
    { id: 'payments', label: t('payments'), count: relationsLoading ? undefined : payments.length },
    { id: 'notes', label: t('notes_attachments'), count: relationsLoading ? undefined : notesLog.length },
    { id: 'inventory', label: t('inventory_movements'), count: relationsLoading ? undefined : inventoryMovements.length },
    { id: 'accounting', label: t('accounting') },
  ];
  const paymentMethod = (method: InvoicePayment['method']) => method === 'bank' ? t('bank') : t('cash');
  const paymentsContent = relationsLoading ? (
    <div className="space-y-3 p-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
  ) : payments.length === 0 ? (
    <p className="p-5 text-center text-sm text-muted">{t('no_payments')}</p>
  ) : (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="border-b border-border bg-muted/40 text-start text-xs text-muted">
          <tr><th className="px-4 py-3 font-medium">{t('payment_number')}</th><th className="px-4 py-3 font-medium">{t('payment_date')}</th><th className="px-4 py-3 font-medium">{t('payment_method')}</th><th className="px-4 py-3 font-medium">{t('voucher_amount')}</th><th className="px-4 py-3 font-medium">{t('allocated_amount')}</th><th className="px-4 py-3 font-medium">{t('status')}</th></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {payments.map((payment) => <tr key={payment.id} className="hover:bg-muted/30"><td className="num px-4 py-3 font-medium text-primary"><Link href={`/payments/${payment.id}`} className="hover:underline">{payment.number}</Link></td><td className="num px-4 py-3 text-text">{payment.payment_date ?? '—'}</td><td className="px-4 py-3 text-text">{paymentMethod(payment.method)}</td><td className="num px-4 py-3 text-text">{formatRiyal(payment.amount)}</td><td className="num px-4 py-3 font-semibold text-text">{formatRiyal(payment.allocated_amount)}</td><td className="px-4 py-3"><Badge tone={statusTone[payment.status] ?? 'muted'}>{ts(payment.status)}</Badge></td></tr>)}
        </tbody>
      </table>
    </div>
  );
  const entryContent = (entry: AccountingEntry | null, label: string, empty: string) => (
    <section className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold text-text"><BookOpen className="h-4 w-4 text-primary" strokeWidth={1.8} />{label}</h3>{entry && <Badge tone={statusTone[entry.status] ?? 'muted'}>{ts(entry.status)}</Badge>}</div>
      {entry ? <><dl className="grid grid-cols-2 gap-3 rounded border border-border bg-background p-3 text-sm sm:grid-cols-3"><div><dt className="text-xs text-muted">{t('entry_number')}</dt><dd className="num mt-1 text-text">{entry.number}</dd></div><div><dt className="text-xs text-muted">{t('entry_date')}</dt><dd className="num mt-1 text-text">{entry.date ?? '—'}</dd></div>{entry.description && <div><dt className="text-xs text-muted">{t('description')}</dt><dd className="mt-1 text-text">{entry.description}</dd></div>}</dl><div className="overflow-x-auto"><table className="w-full min-w-[34rem] text-sm"><thead className="border-b border-border bg-muted/40 text-start text-xs text-muted"><tr><th className="px-3 py-2.5 font-medium">{t('account')}</th><th className="px-3 py-2.5 font-medium">{t('description')}</th><th className="px-3 py-2.5 font-medium">{t('debit')}</th><th className="px-3 py-2.5 font-medium">{t('credit_amount')}</th></tr></thead><tbody className="divide-y divide-border">{entry.lines.map((line) => <tr key={`${entry.id}-${line.account_id}-${line.description ?? ''}`}><td className="px-3 py-2.5 text-text"><span className="num text-muted">{line.account_code}</span>{line.account_name && <span> · {line.account_name}</span>}</td><td className="px-3 py-2.5 text-muted">{line.description ?? '—'}</td><td className="num px-3 py-2.5 text-text">{formatRiyal(line.debit)}</td><td className="num px-3 py-2.5 text-text">{formatRiyal(line.credit)}</td></tr>)}</tbody></table></div></> : <p className="rounded border border-dashed border-border bg-background px-3 py-4 text-sm leading-6 text-muted">{empty}</p>}
    </section>
  );
  const downloadAttachment = async (note: InvoiceNote, attachment: InvoiceNote['attachments'][number]) => {
    try {
      await downloadFile(`/invoices/${invoice.id}/notes/${note.id}/attachments/${attachment.id}/download`, attachment.original_name);
    } catch {
      errorToast(t('action_failed'));
    }
  };
  const notesContent = relationsLoading ? (
    <div className="space-y-3 p-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
  ) : (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">{notesLog.length ? t('notes_attachments') : t('no_notes_attachments')}</p><Button size="sm" variant="outline" onClick={() => setNoteOpen(true)}><Paperclip className="h-4 w-4" strokeWidth={1.7} />{t('add_note_attachment')}</Button></div>
      {notesLog.length > 0 && <div className="space-y-3">{notesLog.map((note) => <article key={note.id} className="rounded border border-border bg-background p-3"><p className="num text-xs text-muted">{formatDateTime(note.recorded_at, locale)}</p>{note.body && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-text">{note.body}</p>}{note.attachments.length > 0 && <ul className="mt-3 divide-y divide-border rounded border border-border">{note.attachments.map((attachment) => <li key={attachment.id} className="flex items-center justify-between gap-3 px-3 py-2"><span className="min-w-0 truncate text-sm text-text">{attachment.original_name}</span><Button size="sm" variant="ghost" onClick={() => downloadAttachment(note, attachment)}><Download className="h-4 w-4" strokeWidth={1.7} />{t('download_attachment')}</Button></li>)}</ul>}</article>)}</div>}
    </div>
  );
  const inventoryContent = relationsLoading ? (
    <div className="space-y-3 p-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
  ) : inventoryMovements.length === 0 ? (
    <div className="p-5 text-center"><Boxes className="mx-auto h-6 w-6 text-muted" strokeWidth={1.5} /><p className="mt-2 text-sm text-muted">{t('no_inventory_movements')}</p></div>
  ) : (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[48rem] text-sm"><thead className="border-b border-border bg-muted/40 text-start text-xs text-muted"><tr><th className="px-4 py-3 font-medium">{t('inventory_product')}</th><th className="px-4 py-3 font-medium">{t('inventory_warehouse')}</th><th className="px-4 py-3 font-medium">{t('inventory_date')}</th><th className="px-4 py-3 font-medium">{t('inventory_direction')}</th><th className="px-4 py-3 font-medium">{t('qty')}</th><th className="px-4 py-3 font-medium">{t('inventory_unit_cost')}</th><th className="px-4 py-3 font-medium">{t('inventory_total_cost')}</th><th className="px-4 py-3 font-medium">{t('inventory_balance')}</th></tr></thead><tbody className="divide-y divide-border">{inventoryMovements.map((movement) => <tr key={movement.id} className="hover:bg-muted/30"><td className="px-4 py-3 text-text"><span className="font-medium">{movement.product?.name ?? '—'}</span>{movement.product?.sku && <span className="num ms-2 text-xs text-muted">{movement.product.sku}</span>}</td><td className="px-4 py-3 text-text">{movement.warehouse ? `${movement.warehouse.code} · ${movement.warehouse.name}` : '—'}</td><td className="num px-4 py-3 text-text">{movement.movement_date ?? '—'}</td><td className="px-4 py-3"><Badge tone={movement.type === 'out' ? 'warning' : movement.type === 'in' ? 'positive' : 'muted'}>{movement.type === 'out' ? t('inventory_out') : movement.type === 'in' ? t('inventory_in') : t('inventory_adjustment')}</Badge></td><td className="num px-4 py-3 text-text">{movement.quantity}</td><td className="num px-4 py-3 text-text">{formatRiyal(movement.unit_cost)}</td><td className="num px-4 py-3 text-text">{formatRiyal(movement.total_cost)}</td><td className="num px-4 py-3 font-medium text-text">{movement.balance_quantity}</td></tr>)}</tbody></table>
    </div>
  );
  const accountingContent = relationsLoading ? (
    <div className="space-y-3 p-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
  ) : (
    <div className="divide-y divide-border">{entryContent(accounting?.sales_entry ?? null, t('sales_entry'), t('no_sales_entry'))}{entryContent(accounting?.cost_entry ?? null, t('cost_entry'), t('no_cost_entry'))}</div>
  );
  const relationContent = relationSection === 'payments'
    ? paymentsContent
    : relationSection === 'notes'
      ? notesContent
      : relationSection === 'inventory'
        ? inventoryContent
        : relationSection === 'accounting' ? accountingContent : null;
  const toggleRelationSection = (section: RelationSection) => setRelationSection((current) => current === section ? null : section);

  const pdfDoc = () => document.getElementById(pdfSharesPrintRoot ? 'print-root' : 'pdf-print-root');
  const paperId = getTemplate(templateId).supportedPaper[0] ?? 'a4';
  const paper = { widthMm: PAPER_SIZES[paperId].widthMm, heightMm: PAPER_SIZES[paperId].heightMm };
  const pdfPaperId = (pdfOutput ? getTemplate(pdfOutput.templateId).supportedPaper[0] : paperId) ?? 'a4';
  const pdfPaper = { widthMm: PAPER_SIZES[pdfPaperId].widthMm, heightMm: PAPER_SIZES[pdfPaperId].heightMm };
  const thermalPaper = thermalPaperForTemplate(thermalOutput?.templateId ?? null);
  const catalogType = invoiceCatalogDocumentType(invoice.zatca_document_type);

  async function handleDownloadPdf() {
    if (!invoice) return;
    setBusy('pdf');
    try {
      const element = pdfDoc();
      if (!element) throw new Error('Invoice template is unavailable');
      await documentExporter.download({ element, fileName: invoice.number, paper: pdfPaper });
      success(t('downloaded_ok'));
    } catch {
      errorToast(t('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleShare() {
    if (!invoice) return;
    setBusy('share');
    try {
      const element = pdfDoc();
      if (!element) throw new Error('Invoice template is unavailable');
      const result = await documentExporter.share({ element, fileName: invoice.number, title: invoice.number, paper: pdfPaper });
      success(result === 'shared' ? t('shared_ok') : t('downloaded_ok'));
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') errorToast(t('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleExcel() {
    if (!invoice) return;
    setBusy('excel');
    try {
      await exportXlsx(invoice.number, {
        meta: [
          [ti('number'), invoice.number],
          [t('date'), invoice.invoice_date],
          [t('partner'), partnerName],
          [t('paid'), Number(invoice.paid_amount)],
          [t('remaining'), Number(invoice.remaining)],
        ],
        columns: [t('description'), t('qty'), t('unit_price'), t('tax'), ti('total')],
        rows: invoice.lines.map((line) => [
          line.description ?? '—',
          line.quantity,
          Number(line.unit_price),
          Number(line.line_tax),
          Number(line.line_total),
        ]),
        sheetName: 'Invoice',
      });
      success(t('downloaded_ok'));
    } catch {
      errorToast(t('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function duplicateInvoice() {
    if (!invoice || duplicating) return;
    setDuplicating(true);
    try {
      const copy = await api<{ data: Invoice }>(`/invoices/${invoice.id}/duplicate`, { method: 'POST' });
      success(t('duplicate_success'));
      router.push(`/invoices/${copy.data.id}/edit`);
    } catch {
      errorToast(t('action_failed'));
    } finally {
      setDuplicating(false);
    }
  }

  async function confirmAction() {
    if (!pendingAction || !invoice) return;
    setActioning(true);
    try {
      if (pendingAction === 'post') {
        await api(`/invoices/${invoice.id}/post`, { method: 'POST' });
        success(t('post_success'));
        setPendingAction(null);
        load();
      } else {
        await api(`/invoices/${invoice.id}`, { method: 'DELETE' });
        success(t('delete_success'));
        router.push('/invoices');
      }
    } catch {
      errorToast(t('action_failed'));
    } finally {
      setActioning(false);
    }
  }

  const workControls = (
    <>
      {isDraft && (
        <Button size="sm" onClick={() => setPendingAction('post')} disabled={actioning}>
          <CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />
          {t('post')}
        </Button>
      )}
    </>
  );

  const invoiceActions = (
    <>
      {isDraft && <DropdownItem icon={Pencil} href={`/invoices/${invoice.id}/edit`}>{t('edit')}</DropdownItem>}
      <DropdownItem icon={Copy} onClick={duplicateInvoice} disabled={duplicating}>{duplicating ? t('duplicating') : t('duplicate')}</DropdownItem>
      {canCollect && <DropdownItem icon={Banknote} href={`/invoices/${invoice.id}/payments/new`}>{t('add_payment')}</DropdownItem>}
      {isPosted && <DropdownItem icon={RotateCcw} onClick={() => setReturnOpen(true)}>{t('create_return')}</DropdownItem>}
      <DropdownItem icon={Paperclip} onClick={() => setNoteOpen(true)}>{t('add_note_attachment')}</DropdownItem>
      <DropdownItem icon={Printer} onClick={() => printDocument(paper, 'print-root')}>{t('print')}</DropdownItem>
      <DropdownItem icon={Download} onClick={handleDownloadPdf}>{busy === 'pdf' ? t('generating') : t('download_pdf')}</DropdownItem>
      <DropdownItem icon={Share2} onClick={handleShare}>{t('share')}</DropdownItem>
      <DropdownItem icon={FileSpreadsheet} onClick={handleExcel}>{t('excel')}</DropdownItem>
      {thermalPaper && (
        <DropdownItem icon={Printer} onClick={() => printDocument(thermalPaper.paper, 'thermal-print-root')}>{tPrint('thermal_print')}</DropdownItem>
      )}
      {isDraft && <DropdownItem icon={Trash2} tone="danger" onClick={() => setPendingAction('delete')}>{t('delete')}</DropdownItem>}
    </>
  );

  const documentPreview = (
    <Card>
      <CardHeader className="no-print p-0">
        <button
          type="button"
          onClick={() => setDocumentOpen((value) => !value)}
          aria-expanded={documentOpen}
          aria-controls="invoice-document-content"
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
        >
          <CardTitle>{t('document')}</CardTitle>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${documentOpen ? 'rotate-180 text-primary' : ''}`} strokeWidth={2} />
        </button>
      </CardHeader>
      <CardContent id="invoice-document-content" className={documentOpen ? 'print:p-0' : 'hidden print:block print:p-0'}>
        <div className="rounded border border-border bg-background p-3 print:border-0 print:bg-transparent print:p-0">
          <DocumentScaler>
            <InvoiceDocument
              invoice={invoice}
              company={company}
              customer={customer}
              qr={zatca?.qr ?? null}
              templateId={templateId}
              themeId={themeId}
              footerText={footerText}
              terms={termsText}
              bank={bankText}
              stampUrl={stampUrl}
              signatureUrl={signatureUrl}
              showLogo={showLogo}
              logoUrl={logoUrl}
              logoHeight={logoHeight}
              layout={layout}
              documentType={catalogType}
            />
          </DocumentScaler>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-5">
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <Button asChild variant="ghost" size="icon" className="no-print shrink-0" aria-label={t('back')}><Link href='/invoices'>
              <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
            </Link></Button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="num text-xl font-semibold text-text">{invoice.number}</h1>
                <Badge tone={statusTone[invoice.status] ?? 'muted'}>{ts(invoice.status)}</Badge>
                <Badge tone={payTone[invoice.payment_status] ?? 'muted'}>{ts(invoice.payment_status)}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted">{isDraft ? t('post_confirm') : t('payment_section_note')}</p>
            </div>
          </div>
          <div className="no-print hidden flex-wrap items-center justify-end gap-2 lg:flex">
            {workControls}
            <Dropdown
              align="end"
              menuLabel={t('actions')}
              triggerLabel={t('actions')}
              triggerClassName="h-8 border border-border px-2 text-text hover:bg-primary-soft"
              trigger={<MoreVertical className="h-4 w-4" strokeWidth={1.8} />}
            >
              {invoiceActions}
            </Dropdown>
          </div>
        </div>

        <div className="no-print lg:hidden">
          <div className="flex flex-wrap items-center gap-2">
            {workControls}
            <Dropdown
              align="end"
              menuLabel={t('actions')}
              triggerLabel={t('actions')}
              mobilePopover
              triggerClassName="h-8 border border-border bg-surface px-2 text-text hover:bg-primary-soft"
              trigger={<MoreVertical className="h-4 w-4" strokeWidth={1.8} />}
            >
              {invoiceActions}
            </Dropdown>
          </div>
        </div>

        {!printLocked && (
        <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface px-3 py-2.5">
          <span className="text-sm font-medium text-text">{t('template')}</span>
          <Dropdown
            align="end"
            menuLabel={t('template')}
            triggerLabel={t('template')}
            triggerClassName="h-8 gap-2 border border-border px-3 text-sm text-text hover:bg-primary-soft"
            trigger={
              <>
                <LayoutTemplate className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
                <span>{tt(getTemplate(templateId).nameKey)}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={1.8} />
              </>
            }
          >
            {PAGE_TEMPLATES.map((definition) => (
              <DropdownItem key={definition.id} onClick={() => setTemplateId(definition.id)}>{tt(definition.nameKey)}</DropdownItem>
            ))}
          </Dropdown>
        </div>
        )}
      </header>

      {documentPreview}

      <section className="grid grid-cols-1 gap-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3 p-0">
            <button type="button" onClick={() => setDetailsOpen((value) => !value)} aria-expanded={detailsOpen} aria-controls="invoice-details-content" className="flex min-w-0 flex-1 items-center justify-between gap-3 px-5 py-4 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
              <CardTitle>{t('details')}</CardTitle>
              <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${detailsOpen ? 'rotate-180 text-primary' : ''}`} strokeWidth={2} />
            </button>
          </CardHeader>
          {detailsOpen && <CardContent id="invoice-details-content">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
              {info.map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs text-muted">{key}</dt>
                  <dd className="mt-1 text-text">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-5 border-t border-border pt-4">
              <p className="text-xs text-muted">{t('notes')}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-text">{invoice.notes || t('no_notes')}</p>
            </div>
            {priceOverrides.length > 0 && <div className="mt-5 border-t border-border pt-4"><p className="text-xs font-medium text-text">{t('minimum_price_overrides')}</p><ul className="mt-2 space-y-2">{priceOverrides.map((line) => <li key={line.id} className="rounded border border-warning/30 bg-warning/5 px-3 py-2 text-sm"><p className="font-medium text-text">{line.product_name ?? line.description ?? t('unknown_item')}</p><p className="mt-1 whitespace-pre-wrap leading-6 text-muted">{line.minimum_price_override?.reason}</p></li>)}</ul></div>}
          </CardContent>}
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4">
        <Card>
          <CardHeader className="p-0">
            <button type="button" onClick={() => setFinancialOpen((value) => !value)} aria-expanded={financialOpen} aria-controls="invoice-financial-content" className="flex w-full items-center justify-between gap-3 px-5 py-4 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
              <CardTitle>{t('financial_summary')}</CardTitle>
              <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${financialOpen ? 'rotate-180 text-primary' : ''}`} strokeWidth={2} />
            </button>
          </CardHeader>
          {financialOpen && <CardContent id="invoice-financial-content">
            <dl className="divide-y divide-border">
              {financialSummary.map(([label, value, strong]) => (
                <div key={label} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                  <dt className={strong ? 'font-medium text-text' : 'text-sm text-muted'}>{label}</dt>
                  <dd className={`num ${strong ? 'text-base font-semibold text-text' : 'text-sm text-text'}`}>{formatRiyal(value)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>}
        </Card>

      </section>

      <section aria-label={t('relations')}>
        {relationsUnavailable && <p className="mb-3 rounded border border-border bg-muted/40 px-3 py-2 text-sm text-text">{t('relations_unavailable')}</p>}
        <Card className="hidden lg:block">
          <CardHeader><CardTitle>{t('relations')}</CardTitle></CardHeader>
          <Tabs tabs={relationTabs} value={relationSection} onChange={(value) => setRelationSection(value as RelationSection)} />
          {relationSection && <CardContent className="p-0"><TabPanel id={relationSection}>{relationContent}</TabPanel></CardContent>}
        </Card>
        <div className="lg:hidden"><Accordion><AccordionItem id="payments" title={t('payments')} count={relationsLoading ? undefined : payments.length} open={relationSection === 'payments'} onToggle={() => toggleRelationSection('payments')}>{paymentsContent}</AccordionItem><AccordionItem id="notes" title={t('notes_attachments')} count={relationsLoading ? undefined : notesLog.length} open={relationSection === 'notes'} onToggle={() => toggleRelationSection('notes')}>{notesContent}</AccordionItem><AccordionItem id="inventory" title={t('inventory_movements')} count={relationsLoading ? undefined : inventoryMovements.length} open={relationSection === 'inventory'} onToggle={() => toggleRelationSection('inventory')}>{inventoryContent}</AccordionItem><AccordionItem id="accounting" title={t('accounting')} open={relationSection === 'accounting'} onToggle={() => toggleRelationSection('accounting')}>{accountingContent}</AccordionItem></Accordion></div>
      </section>

      {!pdfSharesPrintRoot && pdfOutput && (
        <InvoiceDocument
          invoice={invoice}
          company={company}
          customer={customer}
          qr={zatca?.qr ?? null}
          {...documentPropsFromResolved(pdfOutput)}
          documentType={catalogType}
          rootId="pdf-print-root"
        />
      )}

      {thermalPaper && thermalOutput && (
        <InvoiceDocument
          invoice={invoice}
          company={company}
          customer={customer}
          qr={zatca?.qr ?? null}
          {...documentPropsFromResolved(thermalOutput)}
          documentType={catalogType}
          rootId="thermal-print-root"
        />
      )}

      <section aria-label={t('activity')}><RevisionLog type="invoice" id={id} collapsible defaultOpen={false} /></section>

      <CreateReturnDialog
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        onCreated={load}
        fixedType="sales"
        initialSalesInvoice={{ id: invoice.id, partnerId: invoice.partner_id }}
      />
      <InvoiceNoteDialog
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        onSaved={load}
        invoiceId={invoice.id}
      />

      <Dialog
        open={pendingAction !== null}
        onClose={() => (actioning ? null : setPendingAction(null))}
        title={pendingAction === 'post' ? t('post') : t('delete_title')}
      >
        <p className="text-sm leading-6 text-text">
          {pendingAction === 'post' ? t('post_confirm') : <>{t('delete_confirm')} <span className="num font-medium">{invoice.number}</span>؟</>}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" disabled={actioning} onClick={() => setPendingAction(null)}>{t('retry')}</Button>
          <Button variant={pendingAction === 'delete' ? 'danger' : 'primary'} disabled={actioning} onClick={confirmAction}>
            {pendingAction === 'post' ? t('post') : t('delete')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

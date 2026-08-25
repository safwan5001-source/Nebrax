'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  ArrowRight, BookOpen, Boxes, CheckCircle2, ChevronDown, Copy, Download, FileSpreadsheet, FileText,
  LayoutTemplate, MoreVertical, Pencil, Printer, RotateCcw, Share2, Trash2,
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
import type { Party, DocLine } from '@/components/documents/tax-document';
import { PurchaseDocument } from '@/components/purchases/purchase-document';
import { CreateReturnDialog } from '@/components/returns/create-return-dialog';
import { RevisionLog } from '@/components/documents/revision-log';
import { api, ApiError, downloadFile, fetchImageUrl } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { useCompany } from '@/lib/company';
import { exportXlsx } from '@/lib/xlsx';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { documentExporter, printDocument } from '@/modules/documents/services/export';
import { getTemplate, listTemplates, DEFAULT_TEMPLATE_ID } from '@/modules/documents/registry/templates';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import type { ThemeId, DocSectionLayoutItem } from '@/modules/documents/types';
import { resolveLiveTemplateDefinition, type LivePrintTemplateAssignment } from '@/modules/print-templates/services/live-template-definition';

interface FrozenPrintTemplateRevision {
  id: string;
  version: number;
  definition: {
    template_id?: string;
    theme_id?: ThemeId;
    footer_text?: string;
    show_logo?: boolean;
    logo?: string;
    logo_height?: number;
    layout?: DocSectionLayoutItem[];
    terms_text?: string;
    bank_text?: string;
    stamp?: string;
    signature?: string;
  };
  document_types: string[];
}

interface PurchaseAttachment {
  id: string;
  original_name: string;
  mime_type: string | null;
  size: number;
}

interface Purchase {
  id: string;
  branch_id?: string | null;
  number: string;
  partner_id: string;
  payment_type: string;
  status: string;
  document_linked: boolean;
  payment_status: string;
  purchase_date: string;
  supplier_invoice_no: string | null;
  subtotal: string;
  tax_amount: string;
  total: string;
  discount: string;
  shipping: string;
  adjustment: string;
  paid_amount: string;
  remaining: string;
  due_date: string | null;
  received_status: string;
  received_date: string | null;
  lines: DocLine[];
  print_template_revision_id?: string | null;
  print_template_revision?: FrozenPrintTemplateRevision | null;
  pdf_template_revision_id?: string | null;
  pdf_template_revision?: FrozenPrintTemplateRevision | null;
  thermal_template_revision_id?: string | null;
  thermal_template_revision?: FrozenPrintTemplateRevision | null;
  attachments: PurchaseAttachment[];
}

interface PurchasePayment {
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

interface PurchaseAccountingLinks { purchase_entry: AccountingEntry | null }

interface PurchaseInventoryMovement {
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

type PendingAction = 'post' | 'delete' | null;
type ExportBusy = 'pdf' | 'share' | 'excel' | null;
type RelationSection = 'payments' | 'inventory' | 'accounting';

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = { posted: 'positive', draft: 'muted', cancelled: 'negative' };
const payTone: Record<string, 'positive' | 'warning' | 'muted'> = { paid: 'positive', partial: 'warning', unpaid: 'muted' };

function receiptKey(status: string | null | undefined): 'pending' | 'partial' | 'full' {
  if (status === 'partial') return 'partial';
  if (status === 'received' || status === 'full') return 'full';
  return 'pending';
}

export default function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('invoiceDetail');
  const tp = useTranslations('purchases');
  const tpf = useTranslations('purchaseForm');
  const tpp = useTranslations('purchasePdf');
  const ts = useTranslations('status');
  const tPrint = useTranslations('documentPrint');
  const tt = useTranslations('invoiceTemplates');
  const company = useCompany();
  const { success, error: errorToast } = useToast();

  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [supplier, setSupplier] = useState<Party | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<ExportBusy>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [actioning, setActioning] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [payments, setPayments] = useState<PurchasePayment[]>([]);
  const [inventoryMovements, setInventoryMovements] = useState<PurchaseInventoryMovement[]>([]);
  const [accounting, setAccounting] = useState<PurchaseAccountingLinks | null>(null);
  const [relationsLoading, setRelationsLoading] = useState(true);
  const [relationsUnavailable, setRelationsUnavailable] = useState(false);
  const [relationSection, setRelationSection] = useState<RelationSection | null>(null);
  const [documentOpen, setDocumentOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [financialOpen, setFinancialOpen] = useState(false);
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [themeId, setThemeId] = useState<ThemeId | null>(null);
  const [footerText, setFooterText] = useState<string | null>(null);
  const [showLogo, setShowLogo] = useState(true);
  const [logoHeight, setLogoHeight] = useState<number | null>(null);
  const [layout, setLayout] = useState<DocSectionLayoutItem[] | null>(null);
  const [termsText, setTermsText] = useState<string | null>(null);
  const [bankText, setBankText] = useState<string | null>(null);
  const [stampUrl, setStampUrl] = useState<string | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [duplicating, setDuplicating] = useState(false);

  const isDraft = purchase?.status === 'draft';
  const isPosted = purchase?.status === 'posted';
  const canPay = isPosted && purchase?.payment_status !== 'paid';

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    setRelationsLoading(true);
    setRelationsUnavailable(false);
    api<{ data: Purchase }>(`/purchases/${id}`)
      .then(async (response) => {
        setPurchase(response.data);
        const previews = await Promise.all((response.data.attachments ?? [])
          .filter((attachment) => attachment.mime_type?.startsWith('image/'))
          .map(async (attachment) => [attachment.id, await fetchImageUrl(`/purchases/${id}/attachments/${attachment.id}/download`)] as const));
        setAttachmentUrls((current) => {
          Object.values(current).forEach((url) => URL.revokeObjectURL(url));
          return Object.fromEntries(previews.filter(([, url]) => url !== null) as [string, string][]);
        });
        const branchQuery = response.data.branch_id ? `&branch_id=${encodeURIComponent(response.data.branch_id)}` : '';
        const [partner, live, paymentRelations, inventoryRelations, accountingRelations] = await Promise.allSettled([
          api<{ data: Party }>(`/partners/${response.data.partner_id}`),
          api<{ data: LivePrintTemplateAssignment | null }>(`/print-templates/resolve?document_type=purchase_invoice&usage=print${branchQuery}`),
          api<{ data: PurchasePayment[] }>(`/purchases/${id}/payments`),
          api<{ data: PurchaseInventoryMovement[] }>(`/purchases/${id}/inventory`),
          api<{ data: PurchaseAccountingLinks }>(`/purchases/${id}/accounting`),
        ]);
        if (partner.status === 'fulfilled') setSupplier(partner.value.data);
        if (paymentRelations.status === 'fulfilled') setPayments(paymentRelations.value.data);
        if (inventoryRelations.status === 'fulfilled') setInventoryMovements(inventoryRelations.value.data);
        if (accountingRelations.status === 'fulfilled') setAccounting(accountingRelations.value.data);
        setRelationsUnavailable(paymentRelations.status === 'rejected' || inventoryRelations.status === 'rejected' || accountingRelations.status === 'rejected');
        setRelationsLoading(false);

        const frozen = response.data.print_template_revision?.definition;
        if (frozen) {
          setTemplateId(frozen.template_id ?? DEFAULT_TEMPLATE_ID);
          setThemeId(frozen.theme_id ?? null);
          setFooterText(frozen.footer_text ?? null);
          setShowLogo(frozen.show_logo !== false);
          setLogoHeight(frozen.logo_height ?? null);
          setLayout(Array.isArray(frozen.layout) && frozen.layout.length ? frozen.layout : null);
          setTermsText(frozen.terms_text ?? null);
          setBankText(frozen.bank_text ?? null);
          setStampUrl(frozen.stamp ?? null);
          setSignatureUrl(frozen.signature ?? null);
          return;
        }

        const resolved = live.status === 'fulfilled'
          ? resolveLiveTemplateDefinition(live.value.data, 'purchase_invoice')
          : null;
        if (!resolved) return;
        setTemplateId(resolved.templateId);
        setThemeId(resolved.themeId);
        setFooterText(resolved.footerText);
        setShowLogo(resolved.showLogo);
        setLogoHeight(resolved.logoHeight);
        setLayout(resolved.layout);
        setTermsText(resolved.termsText);
        setBankText(resolved.bankText);
        setStampUrl(resolved.stampUrl);
        setSignatureUrl(resolved.signatureUrl);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => load(), [load]);

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>;
  }

  if (loadError) {
    return <div className="rounded border border-border bg-surface p-8 text-center"><p className="text-sm text-negative">{t('load_error')}</p><Button variant="outline" className="mt-3" onClick={load}>{t('retry')}</Button></div>;
  }

  // نصٌّ عارٍ بلا طريق رجوع كان يترك المستخدم عالقاً. باقي الصفحة خارج نطاق
  // المرحلة (مساحة عمل مستندية، انظر مسح المرحلة ٣) ولم يُمَس.
  if (!purchase) {
    return (
      <EmptyState
        title={t('not_found')}
        action={<Button asChild variant="outline"><Link href="/purchases">{t('back')}</Link></Button>}
      />
    );
  }

  const receivedStatusKey = receiptKey(purchase.received_status);
  const receivedStatusLabel = tpp(`received_${receivedStatusKey}`);
  const supplierName = supplier?.name ?? '—';
  const paperId = getTemplate(templateId).supportedPaper[0] ?? 'a4';
  const paper = { widthMm: PAPER_SIZES[paperId].widthMm, heightMm: PAPER_SIZES[paperId].heightMm };
  const frozenThermalDefinition = purchase.thermal_template_revision?.definition ?? null;
  const thermalTemplateId = frozenThermalDefinition?.template_id ?? null;
  const thermalPaperId = thermalTemplateId
    ? getTemplate(thermalTemplateId).supportedPaper.find((candidate) => candidate.startsWith('thermal_'))
    : null;
  const thermalPaper = thermalPaperId ? { widthMm: PAPER_SIZES[thermalPaperId].widthMm, heightMm: PAPER_SIZES[thermalPaperId].heightMm } : null;

  const info: [string, React.ReactNode][] = [
    [tp('supplier'), supplier ? <Link href={`/partners/${purchase.partner_id}`} className="text-primary hover:underline">{supplierName}</Link> : supplierName],
    [t('date'), <span key="purchase-date" className="num">{purchase.purchase_date}</span>],
    [t('due_date'), <span key="due-date" className="num">{purchase.due_date ?? '—'}</span>],
    [t('payment_type'), purchase.payment_type === 'cash' ? t('cash') : t('credit')],
    [t('paid'), <span key="paid" className="num font-medium">{formatRiyal(purchase.paid_amount)}</span>],
    [t('remaining'), <span key="remaining" className="num font-semibold">{formatRiyal(purchase.remaining)}</span>],
    [tpf('received_status'), receivedStatusLabel],
    [tpf('received_date'), <span key="received-date" className="num">{purchase.received_date ?? '—'}</span>],
    [tp('supplier_invoice_no'), <span key="supplier-invoice-no" className="num">{purchase.supplier_invoice_no ?? '—'}</span>],
  ];
  const financialSummary: [string, string, boolean][] = [
    [t('subtotal'), purchase.subtotal, false],
    [t('discount'), purchase.discount, false],
    [t('shipping'), purchase.shipping, false],
    [t('adjustment'), purchase.adjustment, false],
    [t('tax_amount'), purchase.tax_amount, false],
    [t('grand_total'), purchase.total, true],
  ];
  const relationTabs = [
    { id: 'payments', label: t('payments'), count: relationsLoading ? undefined : payments.length },
    { id: 'inventory', label: t('inventory_movements'), count: relationsLoading ? undefined : inventoryMovements.length },
    { id: 'accounting', label: t('accounting') },
  ];
  const paymentMethod = (method: PurchasePayment['method']) => method === 'bank' ? t('bank') : t('cash');
  const paymentsContent = relationsLoading ? (
    <div className="space-y-3 p-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
  ) : payments.length === 0 ? (
    <p className="p-5 text-center text-sm text-muted">{t('no_payments')}</p>
  ) : (
    <div className="overflow-x-auto"><table className="w-full min-w-[40rem] text-sm"><thead className="border-b border-border bg-muted/40 text-start text-xs text-muted"><tr><th className="px-4 py-3 font-medium">{t('payment_number')}</th><th className="px-4 py-3 font-medium">{t('payment_date')}</th><th className="px-4 py-3 font-medium">{t('payment_method')}</th><th className="px-4 py-3 font-medium">{t('voucher_amount')}</th><th className="px-4 py-3 font-medium">{t('allocated_amount')}</th><th className="px-4 py-3 font-medium">{t('status')}</th></tr></thead><tbody className="divide-y divide-border">{payments.map((payment) => <tr key={payment.id} className="hover:bg-muted/30"><td className="num px-4 py-3 font-medium text-primary"><Link href={`/payments/${payment.id}`} className="hover:underline">{payment.number}</Link></td><td className="num px-4 py-3 text-text">{payment.payment_date ?? '—'}</td><td className="px-4 py-3 text-text">{paymentMethod(payment.method)}</td><td className="num px-4 py-3 text-text">{formatRiyal(payment.amount)}</td><td className="num px-4 py-3 font-semibold text-text">{formatRiyal(payment.allocated_amount)}</td><td className="px-4 py-3"><Badge tone={statusTone[payment.status] ?? 'muted'}>{ts(payment.status)}</Badge></td></tr>)}</tbody></table></div>
  );

  const inventoryContent = relationsLoading ? (
    <div className="space-y-3 p-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
  ) : inventoryMovements.length === 0 ? (
    <div className="p-5 text-center"><Boxes className="mx-auto h-6 w-6 text-muted" strokeWidth={1.5} /><p className="mt-2 text-sm text-muted">{t('no_inventory_movements')}</p></div>
  ) : (
    <div className="overflow-x-auto"><table className="w-full min-w-[48rem] text-sm"><thead className="border-b border-border bg-muted/40 text-start text-xs text-muted"><tr><th className="px-4 py-3 font-medium">{t('inventory_product')}</th><th className="px-4 py-3 font-medium">{t('inventory_warehouse')}</th><th className="px-4 py-3 font-medium">{t('inventory_date')}</th><th className="px-4 py-3 font-medium">{t('inventory_direction')}</th><th className="px-4 py-3 font-medium">{t('qty')}</th><th className="px-4 py-3 font-medium">{t('inventory_unit_cost')}</th><th className="px-4 py-3 font-medium">{t('inventory_total_cost')}</th><th className="px-4 py-3 font-medium">{t('inventory_balance')}</th></tr></thead><tbody className="divide-y divide-border">{inventoryMovements.map((movement) => <tr key={movement.id} className="hover:bg-muted/30"><td className="px-4 py-3 text-text"><span className="font-medium">{movement.product?.name ?? '—'}</span>{movement.product?.sku && <span className="num ms-2 text-xs text-muted">{movement.product.sku}</span>}</td><td className="px-4 py-3 text-text">{movement.warehouse ? `${movement.warehouse.code} · ${movement.warehouse.name}` : '—'}</td><td className="num px-4 py-3 text-text">{movement.movement_date ?? '—'}</td><td className="px-4 py-3"><Badge tone={movement.type === 'out' ? 'warning' : movement.type === 'in' ? 'positive' : 'muted'}>{movement.type === 'out' ? t('inventory_out') : movement.type === 'in' ? t('inventory_in') : t('inventory_adjustment')}</Badge></td><td className="num px-4 py-3 text-text">{movement.quantity}</td><td className="num px-4 py-3 text-text">{formatRiyal(movement.unit_cost)}</td><td className="num px-4 py-3 text-text">{formatRiyal(movement.total_cost)}</td><td className="num px-4 py-3 font-medium text-text">{movement.balance_quantity}</td></tr>)}</tbody></table></div>
  );

  const accountingContent = relationsLoading ? (
    <div className="space-y-3 p-4"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
  ) : (
    <section className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold text-text"><BookOpen className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('purchase_entry')}</h3>{accounting?.purchase_entry && <Badge tone={statusTone[accounting.purchase_entry.status] ?? 'muted'}>{ts(accounting.purchase_entry.status)}</Badge>}</div>
      {accounting?.purchase_entry ? <><dl className="grid grid-cols-2 gap-3 rounded border border-border bg-background p-3 text-sm sm:grid-cols-3"><div><dt className="text-xs text-muted">{t('entry_number')}</dt><dd className="num mt-1 text-text">{accounting.purchase_entry.number}</dd></div><div><dt className="text-xs text-muted">{t('entry_date')}</dt><dd className="num mt-1 text-text">{accounting.purchase_entry.date ?? '—'}</dd></div>{accounting.purchase_entry.description && <div><dt className="text-xs text-muted">{t('description')}</dt><dd className="mt-1 text-text">{accounting.purchase_entry.description}</dd></div>}</dl><div className="overflow-x-auto"><table className="w-full min-w-[34rem] text-sm"><thead className="border-b border-border bg-muted/40 text-start text-xs text-muted"><tr><th className="px-3 py-2.5 font-medium">{t('account')}</th><th className="px-3 py-2.5 font-medium">{t('description')}</th><th className="px-3 py-2.5 font-medium">{t('debit')}</th><th className="px-3 py-2.5 font-medium">{t('credit_amount')}</th></tr></thead><tbody className="divide-y divide-border">{accounting.purchase_entry.lines.map((line) => <tr key={`${accounting.purchase_entry?.id}-${line.account_id}-${line.description ?? ''}`}><td className="px-3 py-2.5 text-text"><span className="num text-muted">{line.account_code}</span>{line.account_name && <span> · {line.account_name}</span>}</td><td className="px-3 py-2.5 text-muted">{line.description ?? '—'}</td><td className="num px-3 py-2.5 text-text">{formatRiyal(line.debit)}</td><td className="num px-3 py-2.5 text-text">{formatRiyal(line.credit)}</td></tr>)}</tbody></table></div></> : <p className="rounded border border-dashed border-border bg-background px-3 py-4 text-sm leading-6 text-muted">{t('no_purchase_entry')}</p>}
    </section>
  );

  const relationContent = relationSection === 'payments' ? paymentsContent : relationSection === 'inventory' ? inventoryContent : relationSection === 'accounting' ? accountingContent : null;
  const toggleRelationSection = (section: RelationSection) => setRelationSection((current) => current === section ? null : section);

  async function handleDownloadPdf() {
    if (!purchase) return;
    setBusy('pdf');
    try {
      const element = document.getElementById('print-root');
      if (!element) throw new Error('Purchase template is unavailable');
      await documentExporter.download({ element, fileName: purchase.number, paper });
      success(t('downloaded_ok'));
    } catch {
      errorToast(t('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleSharePdf() {
    if (!purchase) return;
    setBusy('share');
    try {
      const element = document.getElementById('print-root');
      if (!element) throw new Error('Purchase template is unavailable');
      const result = await documentExporter.share({ element, fileName: purchase.number, title: purchase.number, paper });
      success(result === 'shared' ? t('shared_ok') : t('downloaded_ok'));
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') errorToast(t('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleExcel() {
    if (!purchase) return;
    setBusy('excel');
    try {
      await exportXlsx(purchase.number, {
        meta: [[tp('number'), purchase.number], [tp('supplier'), supplierName], [t('date'), purchase.purchase_date], [tp('total'), Number(purchase.total)]],
        columns: [t('description'), t('qty'), t('unit_price'), t('tax'), tp('total')],
        rows: purchase.lines.map((line) => [line.description ?? '—', line.quantity, Number(line.unit_price), Number(line.line_tax), Number(line.line_total)]),
        sheetName: 'Purchase invoice',
      });
      success(t('downloaded_ok'));
    } catch {
      errorToast(t('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleDuplicate() {
    if (!purchase) return;
    setDuplicating(true);
    try {
      const response = await api<{ data: { id: string } }>(`/purchases/${purchase.id}/duplicate`, { method: 'POST' });
      success(t('duplicate_success'));
      router.push(`/purchases/${response.data.id}/edit`);
    } catch (error) {
      errorToast(error instanceof ApiError ? error.message : t('action_failed'));
    } finally {
      setDuplicating(false);
    }
  }

  async function confirmAction() {
    if (!pendingAction || !purchase) return;
    setActioning(true);
    try {
      if (pendingAction === 'post') {
        await api(`/purchases/${purchase.id}/post`, { method: 'POST' });
        success(t('post_success'));
        setPendingAction(null);
        load();
      } else {
        await api(`/purchases/${purchase.id}`, { method: 'DELETE' });
        success(tp('deleted'));
        router.push('/purchases');
      }
    } catch (error) {
      errorToast(error instanceof ApiError ? error.message : t('action_failed'));
    } finally {
      setActioning(false);
    }
  }

  const canDeleteDraft = isDraft && !purchase.document_linked;
  const workControls = isDraft ? <Button size="sm" onClick={() => setPendingAction('post')} disabled={actioning}><CheckCircle2 className="h-4 w-4" strokeWidth={1.7} />{t('post')}</Button> : null;
  const purchaseActions = <>
    {isDraft && <DropdownItem icon={Pencil} href={`/purchases/${purchase.id}/edit`}>{tp('edit')}</DropdownItem>}
    <DropdownItem icon={Copy} onClick={handleDuplicate}>{duplicating ? t('duplicating') : t('duplicate')}</DropdownItem>
    {canPay && <DropdownItem icon={RotateCcw} href={`/purchases/${purchase.id}/payments/new`}>{t('add_payment')}</DropdownItem>}
    {isPosted && <DropdownItem icon={RotateCcw} onClick={() => setReturnOpen(true)}>{t('create_return')}</DropdownItem>}
    <DropdownItem icon={Printer} onClick={() => printDocument(paper, 'print-root')}>{t('print')}</DropdownItem>
    <DropdownItem icon={Download} onClick={handleDownloadPdf}>{busy === 'pdf' ? t('generating') : t('download_pdf')}</DropdownItem>
    <DropdownItem icon={Share2} onClick={handleSharePdf}>{t('share')}</DropdownItem>
    <DropdownItem icon={FileSpreadsheet} onClick={handleExcel}>{t('excel')}</DropdownItem>
    {frozenThermalDefinition && thermalPaper && thermalTemplateId && <DropdownItem icon={Printer} onClick={() => printDocument(thermalPaper, 'thermal-print-root')}>{tPrint('thermal_print')}</DropdownItem>}
    {isDraft && <DropdownItem icon={Trash2} tone="danger" disabled={!canDeleteDraft} onClick={() => setPendingAction('delete')}>{tp('delete')}</DropdownItem>}
  </>;

  const documentPreview = <Card>
    <CardHeader className="no-print p-0"><button type="button" onClick={() => setDocumentOpen((value) => !value)} aria-expanded={documentOpen} aria-controls="purchase-document-content" className="flex w-full items-center justify-between gap-3 px-5 py-4 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"><CardTitle>{t('document')}</CardTitle><ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${documentOpen ? 'rotate-180 text-primary' : ''}`} strokeWidth={2} /></button></CardHeader>
    <CardContent id="purchase-document-content" className={documentOpen ? 'print:p-0' : 'hidden print:block print:p-0'}><div className="rounded border border-border bg-background p-3 print:border-0 print:bg-transparent print:p-0"><DocumentScaler><PurchaseDocument purchase={purchase} company={company} supplier={supplier} templateId={templateId} themeId={themeId} footerText={footerText} terms={termsText} bank={bankText} stampUrl={stampUrl} signatureUrl={signatureUrl} showLogo={showLogo} logoHeight={logoHeight} layout={layout} /></DocumentScaler></div></CardContent>
  </Card>;

  return <div className="space-y-5">
    <header className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-2"><Button asChild variant="ghost" size="icon" className="no-print shrink-0" aria-label={t('back')}><Link href='/purchases'><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Link></Button><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="num text-xl font-semibold text-text">{purchase.number}</h1><Badge tone={statusTone[purchase.status] ?? 'muted'}>{ts(purchase.status)}</Badge><Badge tone={payTone[purchase.payment_status] ?? 'muted'}>{ts(purchase.payment_status)}</Badge><Badge tone={receivedStatusKey === 'full' ? 'positive' : receivedStatusKey === 'partial' ? 'warning' : 'muted'}>{receivedStatusLabel}</Badge></div><p className="mt-1 text-sm text-muted">{isDraft ? (purchase.document_linked ? t('document_linked_locked') : t('post_confirm')) : t('payment_section_note')}</p></div></div><div className="no-print hidden flex-wrap items-center justify-end gap-2 lg:flex">{workControls}<Dropdown align="end" menuLabel={tp('actions')} triggerLabel={tp('actions')} triggerClassName="h-8 border border-border px-2 text-text hover:bg-primary-soft" trigger={<MoreVertical className="h-4 w-4" strokeWidth={1.8} />}>{purchaseActions}</Dropdown></div></div>
      <div className="no-print lg:hidden"><div className="flex flex-wrap items-center gap-2">{workControls}<Dropdown align="end" menuLabel={tp('actions')} triggerLabel={tp('actions')} mobilePopover triggerClassName="h-8 border border-border bg-surface px-2 text-text hover:bg-primary-soft" trigger={<MoreVertical className="h-4 w-4" strokeWidth={1.8} />}>{purchaseActions}</Dropdown></div></div>
      <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface px-3 py-2.5"><span className="text-sm font-medium text-text">{t('template')}</span><Dropdown align="end" menuLabel={t('template')} triggerLabel={t('template')} triggerClassName="h-8 gap-2 border border-border px-3 text-sm text-text hover:bg-primary-soft" trigger={<><LayoutTemplate className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} /><span>{tt(getTemplate(templateId).nameKey)}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={1.8} /></>}>{listTemplates().map((definition) => <DropdownItem key={definition.id} onClick={() => setTemplateId(definition.id)}>{tt(definition.nameKey)}</DropdownItem>)}</Dropdown></div>
    </header>

    {documentPreview}

    <Card><CardHeader className="flex-row items-center justify-between gap-3 p-0"><button type="button" onClick={() => setDetailsOpen((value) => !value)} aria-expanded={detailsOpen} aria-controls="purchase-details-content" className="flex min-w-0 flex-1 items-center justify-between gap-3 px-5 py-4 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"><CardTitle>{t('details')}</CardTitle><ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${detailsOpen ? 'rotate-180 text-primary' : ''}`} strokeWidth={2} /></button></CardHeader>{detailsOpen && <CardContent id="purchase-details-content"><dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">{info.map(([key, value]) => <div key={key}><dt className="text-xs text-muted">{key}</dt><dd className="mt-1 text-text">{value}</dd></div>)}</dl></CardContent>}</Card>

    <Card><CardHeader className="p-0"><button type="button" onClick={() => setFinancialOpen((value) => !value)} aria-expanded={financialOpen} aria-controls="purchase-financial-content" className="flex w-full items-center justify-between gap-3 px-5 py-4 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"><CardTitle>{t('financial_summary')}</CardTitle><ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${financialOpen ? 'rotate-180 text-primary' : ''}`} strokeWidth={2} /></button></CardHeader>{financialOpen && <CardContent id="purchase-financial-content"><dl className="divide-y divide-border">{financialSummary.map(([label, value, strong]) => <div key={label} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"><dt className={strong ? 'font-medium text-text' : 'text-sm text-muted'}>{label}</dt><dd className={`num ${strong ? 'text-base font-semibold text-text' : 'text-sm text-text'}`}>{formatRiyal(value)}</dd></div>)}</dl></CardContent>}</Card>

    <Card><CardHeader><CardTitle>{t('attachments')}</CardTitle></CardHeader><CardContent>{purchase.attachments.length === 0 ? <p className="text-sm text-muted">{t('no_attachments')}</p> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{purchase.attachments.map((attachment) => { const previewUrl = attachmentUrls[attachment.id]; return <article key={attachment.id} className="overflow-hidden rounded border border-border bg-background"><button type="button" className="block w-full bg-muted/30 text-start" onClick={() => previewUrl && window.open(previewUrl, '_blank', 'noopener,noreferrer')} disabled={!previewUrl} aria-label={attachment.original_name}>{previewUrl ? <img src={previewUrl} alt={attachment.original_name} className="h-40 w-full object-contain" /> : <div className="flex h-40 items-center justify-center"><FileText className="h-10 w-10 text-muted" strokeWidth={1.5} /></div>}</button><div className="flex items-center justify-between gap-2 border-t border-border p-3"><span className="min-w-0 truncate text-sm text-text" title={attachment.original_name}>{attachment.original_name}</span><Button variant="outline" size="sm" onClick={() => downloadFile(`/purchases/${id}/attachments/${attachment.id}/download`, attachment.original_name).catch((error) => errorToast(error instanceof ApiError ? error.message : t('action_failed')))}><Download className="h-4 w-4" strokeWidth={1.7} />{t('download_attachment')}</Button></div></article>; })}</div>}</CardContent></Card>

    <section aria-label={t('relations')}>{relationsUnavailable && <p className="mb-3 rounded border border-border bg-muted/40 px-3 py-2 text-sm text-text">{t('relations_unavailable')}</p>}<Card className="hidden lg:block"><CardHeader><CardTitle>{t('relations')}</CardTitle></CardHeader><Tabs tabs={relationTabs} value={relationSection} onChange={(value) => setRelationSection(value as RelationSection)} />{relationSection && <CardContent className="p-0"><TabPanel id={relationSection}>{relationContent}</TabPanel></CardContent>}</Card><div className="lg:hidden"><Accordion><AccordionItem id="payments" title={t('payments')} count={relationsLoading ? undefined : payments.length} open={relationSection === 'payments'} onToggle={() => toggleRelationSection('payments')}>{paymentsContent}</AccordionItem><AccordionItem id="inventory" title={t('inventory_movements')} count={relationsLoading ? undefined : inventoryMovements.length} open={relationSection === 'inventory'} onToggle={() => toggleRelationSection('inventory')}>{inventoryContent}</AccordionItem><AccordionItem id="accounting" title={t('accounting')} open={relationSection === 'accounting'} onToggle={() => toggleRelationSection('accounting')}>{accountingContent}</AccordionItem></Accordion></div></section>

    {frozenThermalDefinition && thermalPaper && thermalTemplateId && <PurchaseDocument purchase={purchase} company={company} supplier={supplier} templateId={thermalTemplateId} themeId={frozenThermalDefinition.theme_id ?? null} footerText={frozenThermalDefinition.footer_text ?? null} terms={frozenThermalDefinition.terms_text ?? null} bank={frozenThermalDefinition.bank_text ?? null} stampUrl={frozenThermalDefinition.stamp ?? null} signatureUrl={frozenThermalDefinition.signature ?? null} showLogo={frozenThermalDefinition.show_logo !== false} logoUrl={frozenThermalDefinition.logo ?? null} logoHeight={frozenThermalDefinition.logo_height ?? null} layout={Array.isArray(frozenThermalDefinition.layout) && frozenThermalDefinition.layout.length ? frozenThermalDefinition.layout : null} rootId="thermal-print-root" />}

    <section aria-label={t('activity')}><RevisionLog type="purchase" id={id} collapsible defaultOpen={false} /></section>

    <CreateReturnDialog open={returnOpen} onClose={() => setReturnOpen(false)} onCreated={() => { setReturnOpen(false); load(); }} fixedType="purchase" initialPurchase={{ id: purchase.id, partnerId: purchase.partner_id }} />
    <Dialog open={pendingAction !== null} onClose={() => (actioning ? null : setPendingAction(null))} title={pendingAction === 'post' ? t('post') : tp('delete_title')}><p className="text-sm text-text">{pendingAction === 'post' ? t('post_confirm') : <>{tp('delete_confirm')} <span className="num font-medium">{purchase.number}</span>؟</>}</p><div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setPendingAction(null)} disabled={actioning}>{tp('cancel')}</Button><Button variant={pendingAction === 'delete' ? 'danger' : 'primary'} onClick={confirmAction} disabled={actioning}>{pendingAction === 'post' ? t('post') : tp('delete')}</Button></div></Dialog>
  </div>;
}

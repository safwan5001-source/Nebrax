'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, ChevronDown, Plus, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionItem } from '@/components/ui/accordion';
import { Tabs, TabPanel, type TabDef } from '@/components/ui/tabs';
import { ActionBar, OverflowMenu, overflowActions, primaryActions } from '@/components/partners/partner-actions';
import { IdentityCard, MoneyCard } from '@/components/partners/partner-summary';
import {
  DocTable, EmptyPanel, KeyValue, LedgerTable, SubHead,
  type DocRow, type StatementRow,
} from '@/components/partners/partner-panels';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface Partner {
  id: string; code: string | null; type: string; entity_type: string; name: string; name_en: string | null;
  vat_number: string | null; cr_number: string | null; email: string | null;
  phone: string | null; mobile: string | null; address: string | null; city: string | null;
  building_no: string | null; street: string | null; district: string | null;
  postal_code: string | null; country: string | null;
  classification: string | null; credit_limit: string | null; credit_period: number | null;
  is_active: boolean;
}
interface Statement {
  partner: { id: string; name: string; type: string };
  opening_balance: string;
  rows: StatementRow[];
  closing_balance: string;
}
interface ApiDoc {
  id: string; number: string; partner_id: string; status: string;
  total?: string; amount?: string; remaining?: string;
  invoice_date?: string; due_date?: string | null; payment_date?: string;
  quote_date?: string; note_date?: string; return_date?: string;
}

const SECTIONS = [
  'details', 'invoices', 'payments', 'ledger', 'quotes',
  'balance', 'membership', 'timeline', 'activity',
] as const;
type SectionId = (typeof SECTIONS)[number];

export default function PartnerProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations('partnerProfile');
  const tp = useTranslations('partners');
  const ts = useTranslations('status');

  const [partner, setPartner] = useState<Partner | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [invoices, setInvoices] = useState<ApiDoc[]>([]);
  const [payments, setPayments] = useState<ApiDoc[]>([]);
  const [quotes, setQuotes] = useState<ApiDoc[]>([]);
  const [creditNotes, setCreditNotes] = useState<ApiDoc[]>([]);
  const [returns, setReturns] = useState<ApiDoc[]>([]);
  const [loading, setLoading] = useState(true);

  // القسم النشط مشترك بين تبويبات الديسكتوب وأكورديون الجوال — فلا يفقد
  // المستخدم موضعه عند تغيّر المقاس. `?section=` يسمح بالربط المباشر إليه.
  const initial = (params.get('section') as SectionId) ?? 'details';
  const [section, setSection] = useState<SectionId>(SECTIONS.includes(initial) ? initial : 'details');
  // الجوال وحده يسمح بطيّ القسم النشط؛ `section` يبقى دائماً معرّفاً صالحاً
  // فلا يخلو الديسكتوب من تبويب نشط عند تبديل المقاس.
  const [collapsed, setCollapsed] = useState(false);

  // رابط يحمل `?section=` (كزرّ «كشف حساب») يجب أن ينقل القسم فعلاً — والتنقّل
  // إلى المسار نفسه لا يُعيد تركيب الصفحة، فتُقرأ المعاملة عند كل تغيّر.
  useEffect(() => {
    const s = params.get('section');
    if (s && (SECTIONS as readonly string[]).includes(s)) {
      setSection(s as SectionId);
      setCollapsed(false);
    }
  }, [params]);

  useEffect(() => {
    setLoading(true);
    const list = (path: string) => api<{ data: ApiDoc[] }>(path).then((r) => r.data).catch(() => []);

    Promise.all([
      // المورد مغلَّف بـ `{data}` (JsonResource) — تفريغه هنا، وإلا بقيت كل
      // حقول البطاقة فارغة صامتةً كما كان يحدث قبل هذه الشاشة.
      api<{ data: Partner }>(`/partners/${id}`).then((r) => setPartner(r.data)).catch(() => setPartner(null)),
      api<Statement>(`/reports/partner-statement/${id}`).then(setStatement).catch(() => setStatement(null)),
      list('/invoices').then(setInvoices),
      list('/payments').then(setPayments),
      list('/quotes').then(setQuotes),
      list('/credit-notes').then(setCreditNotes),
      list('/returns').then(setReturns),
    ]).finally(() => setLoading(false));
  }, [id]);

  // ── اشتقاقات عرضية بحتة: كلها مجاميع لقيم يحسبها الـ backend، بلا حساب مالي جديد ──
  const mine = useMemo(() => {
    const of = (rows: ApiDoc[]) => rows.filter((r) => r.partner_id === id);
    return {
      invoices: of(invoices), payments: of(payments), quotes: of(quotes),
      creditNotes: of(creditNotes), returns: of(returns),
    };
  }, [id, invoices, payments, quotes, creditNotes, returns]);

  const sum = (rows: ApiDoc[], key: 'total' | 'amount' | 'remaining') =>
    rows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);

  const posted = mine.invoices.filter((i) => i.status === 'posted');
  const today = new Date().toISOString().slice(0, 10);

  /** مفتوح = كل المتبقّي على الفواتير المرحّلة. */
  const openAmount = sum(posted, 'remaining');
  /** المطلوب دفعه = المتبقّي على ما تجاوز تاريخ استحقاقه فقط. */
  const dueAmount = sum(posted.filter((i) => i.due_date && i.due_date < today), 'remaining');
  /** دائن = رصيد الطرف حين يميل لصالحه (رصيد ختامي سالب). */
  const closing = Number(statement?.closing_balance ?? 0);
  const creditAmount = closing < 0 ? -closing : 0;

  const lastInvoice = posted[0] ?? mine.invoices[0] ?? null;
  const lastPayment = mine.payments[0] ?? null;
  const overdueCount = posted.filter((i) => Number(i.remaining ?? 0) > 0).length;

  const address = partner
    ? [partner.address, partner.building_no, partner.street, partner.district, partner.city, partner.postal_code, partner.country]
        .filter(Boolean).join('، ')
    : '';

  const actions = primaryActions(t, id);
  const overflow = overflowActions(t);

  const tabs: TabDef[] = [
    { id: 'details', label: t('tab_details') },
    { id: 'invoices', label: t('tab_invoices'), count: mine.invoices.length },
    { id: 'payments', label: t('tab_payments'), count: mine.payments.length },
    { id: 'ledger', label: t('tab_ledger'), count: statement?.rows.length ?? 0 },
    { id: 'quotes', label: t('tab_quotes'), count: mine.quotes.length },
    { id: 'balance', label: t('tab_balance') },
    { id: 'membership', label: t('tab_membership') },
    { id: 'timeline', label: t('tab_timeline') },
    { id: 'activity', label: t('tab_activity') },
  ];

  const docLabels = {
    number: t('col_number'), date: t('col_date'), status: t('col_status'),
    total: t('col_total'), remaining: t('col_remaining'), empty: t('empty_docs'),
  };
  const statusLabel = (s: string) => ts(s);

  function panel(s: SectionId) {
    switch (s) {
      case 'details':
        return (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x lg:divide-x-reverse lg:divide-border">
              <div>
                <SubHead>{t('company_data')}</SubHead>
                <KeyValue label={tp('vat_number')} value={partner?.vat_number || '—'} mono />
                <KeyValue label={tp('cr_number')} value={partner?.cr_number || '—'} mono />
                <KeyValue label={t('country_code')} value={partner?.country || '—'} />
                <KeyValue label={t('classification')} value={partner?.classification || '—'} />
              </div>
              <div>
                <SubHead>{t('quick_info')}</SubHead>
                <KeyValue label={t('invoice_count')} value={mine.invoices.length} href="/invoices" mono />
                <KeyValue label={t('due_invoice_count')} value={overdueCount} href="/invoices" mono />
                <KeyValue
                  label={t('last_invoice')}
                  value={lastInvoice ? `${lastInvoice.number} · ${formatRiyal(lastInvoice.total)}` : '—'}
                  href={lastInvoice ? `/invoices/${lastInvoice.id}` : undefined}
                  mono
                />
                <KeyValue
                  label={t('last_payment')}
                  value={lastPayment?.number ?? '—'}
                  href={lastPayment ? `/payments/${lastPayment.id}` : undefined}
                  mono
                />
              </div>
            </div>
            {accountSummary()}
          </>
        );
      case 'invoices':
        return (
          <DocTable
            rows={toRows(mine.invoices, 'invoice_date')}
            href={(x) => `/invoices/${x}`}
            labels={docLabels}
            statusLabel={statusLabel}
            withRemaining
          />
        );
      case 'payments':
        return (
          <DocTable
            rows={toRows(mine.payments, 'payment_date', 'amount')}
            href={(x) => `/payments/${x}`}
            labels={docLabels}
            statusLabel={statusLabel}
          />
        );
      case 'ledger':
        return statement ? (
          <LedgerTable
            opening={statement.opening_balance}
            rows={statement.rows}
            labels={{
              date: t('col_date'), number: t('col_entry'), description: t('col_description'),
              debit: t('col_debit'), credit: t('col_credit'), balance: t('col_balance'),
              opening: t('opening'), empty: t('empty_ledger'),
            }}
          />
        ) : (
          <EmptyPanel>{t('empty_ledger')}</EmptyPanel>
        );
      case 'quotes':
        return (
          <DocTable
            rows={toRows(mine.quotes, 'quote_date')}
            href={(x) => `/quotes/${x}`}
            labels={docLabels}
            statusLabel={statusLabel}
          />
        );
      case 'balance':
        return accountSummary();
      case 'membership':
        return <EmptyPanel>{t('empty_membership')}</EmptyPanel>;
      case 'timeline':
        return <EmptyPanel>{t('empty_timeline')}</EmptyPanel>;
      case 'activity':
        return <EmptyPanel>{t('empty_activity')}</EmptyPanel>;
    }
  }

  /** مختصر الحساب — مجاميع مشتقّة من مبالغ المستندات كما يعيدها الـ backend. */
  function accountSummary() {
    const gross = sum(mine.invoices.filter((i) => i.status === 'posted'), 'total');
    const returned = sum(mine.returns.filter((r) => r.status === 'posted'), 'total');
    const credited = sum(mine.creditNotes.filter((c) => c.status === 'posted'), 'total');
    const paid = gross - openAmount;

    return (
      <>
        <SubHead>{t('account_summary')}</SubHead>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border bg-background text-xs text-muted">
                {[t('col_currency'), t('col_gross'), t('col_returned'), t('col_paid'), t('col_credit_notes'), t('col_due')]
                  .map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2.5 text-start font-semibold">{h}</th>
                  ))}
              </tr>
            </thead>
            <tbody>
              <tr className="text-sm">
                <td className="px-4 py-3 font-medium text-text">SAR</td>
                <td className="num px-4 py-3">{formatRiyal(gross)}</td>
                <td className="num px-4 py-3">{formatRiyal(returned)}</td>
                <td className="num px-4 py-3 text-negative">−{formatRiyal(paid)}</td>
                <td className="num px-4 py-3">{formatRiyal(credited)}</td>
                <td className="num px-4 py-3 font-semibold">{formatRiyal(openAmount)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!partner) {
    return (
      <div className="rounded border border-border bg-surface p-10 text-center text-sm text-muted">
        {t('not_found')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ① شريط الحالة */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="ghost" size="icon" onClick={() => router.push('/partners')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <div className="min-w-0">
          <div className="text-xs text-muted">
            {tp('title')} {partner.code && <span className="num">#{partner.code}</span>}
          </div>
          <h1 className="truncate text-lg font-semibold text-text">{partner.name}</h1>
        </div>
        {/* «موقوف» تُعلَن فقط عن `false` صريحة — ادّعاء إيقافٍ كاذب أسوأ من العكس. */}
        <Badge tone={partner.is_active === false ? 'muted' : 'positive'}>
          {partner.is_active === false ? t('inactive') : t('active')}
        </Badge>
        <Badge tone="neutral">{tp(partner.type)}</Badge>
        <div className="flex-1" />
        <span className="rounded border border-border bg-surface px-2.5 py-1 text-xs text-muted">
          {t('assigned_to')}: <span className="font-medium text-text">—</span>
        </span>
        <Link href="/accounts" className="text-xs font-medium text-primary hover:underline">
          {t('ledger_account')} ↗
        </Link>
      </div>

      {/* ② زر إضافة + اختر الحالة */}
      <div className="flex flex-wrap gap-2">
        <Link href="/invoices/new">
          <Button>
            <Plus className="h-4 w-4" strokeWidth={2} />
            {t('add')}
          </Button>
        </Link>
        <Button variant="outline" disabled>
          {t('pick_status')}
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.8} />
        </Button>
      </div>

      {/* ③ البطاقات المالية الثلاث */}
      <div className="grid grid-cols-3 gap-2 sm:flex sm:gap-3">
        <MoneyCard tone="due" label={t('money_due')} value={String(dueAmount)} />
        <MoneyCard tone="open" label={t('money_open')} value={String(openAmount)} />
        <MoneyCard
          tone="credit"
          label={t('money_credit')}
          value={String(creditAmount)}
          action={{ label: t('allocate'), href: '/payments' }}
        />
      </div>

      {/* ④ بطاقة الهوية — تحمل زرّ ⋮ على الجوال وحده */}
      <IdentityCard
        name={partner.name}
        address={address}
        addressFallback={t('no_address')}
        action={
          <div className="lg:hidden">
            <OverflowMenu actions={overflow} label={t('more')} />
          </div>
        }
      />

      {/* ⑤+⑥ شريط الإجراءات + ⋮ — ديسكتوب */}
      <div className="hidden lg:block">
        <ActionBar actions={actions} overflow={overflow} overflowLabel={t('more')} />
      </div>
      {/* الجوال: الشريط نفسه بتمرير أفقي، وبلا ⋮ (هو في بطاقة الهوية) */}
      <div className="-mx-4 overflow-x-auto px-4 lg:hidden">
        <div className="flex w-max gap-2">
          {actions.map((a, i) => (
            <MobileAction key={a.key} label={a.label} href={a.href} primary={i === 0} icon={a.icon} />
          ))}
        </div>
      </div>

      {/* ⑦ الأقسام: تبويبات على الديسكتوب، أكورديون على الجوال */}
      <div className="hidden overflow-hidden rounded border border-border bg-surface lg:block">
        <Tabs tabs={tabs} value={section} onChange={(s) => setSection(s as SectionId)} />
        <TabPanel id={section}>{panel(section)}</TabPanel>
      </div>

      <Accordion className="lg:hidden">
        {tabs.map((tab) => (
          <AccordionItem
            key={tab.id}
            id={tab.id}
            title={tab.label}
            count={tab.count}
            open={!collapsed && section === tab.id}
            onToggle={() => {
              // النقر على المفتوح يطويه، وعلى غيره ينقل النشاط إليه.
              if (section === tab.id) setCollapsed((c) => !c);
              else { setSection(tab.id as SectionId); setCollapsed(false); }
            }}
          >
            {/* لا تُبنى شجرة القسم إلا وهو مفتوح — تسعة جداول لا تُنشأ عبثاً. */}
            {!collapsed && section === tab.id && panel(tab.id as SectionId)}
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

/** زرّ إجراء مضغوط لشريط الجوال. */
function MobileAction({
  label, href, primary, icon: Icon,
}: {
  label: string; href?: string; primary?: boolean; icon: LucideIcon;
}) {
  const cls = [
    'inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-3 py-2 text-xs font-medium',
    primary ? 'border-transparent bg-primary text-white' : 'border-border bg-surface text-text',
    !href && !primary ? 'cursor-not-allowed opacity-50' : '',
  ].join(' ');
  const inner = (
    <>
      <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
      {label}
    </>
  );
  return href ? <Link href={href} className={cls}>{inner}</Link> : <button type="button" disabled className={cls}>{inner}</button>;
}

/** يوحّد أشكال المستندات المختلفة (تواريخ ومبالغ بأسماء حقول مختلفة) في صفّ واحد. */
function toRows(docs: ApiDoc[], dateKey: keyof ApiDoc, amountKey: 'total' | 'amount' = 'total'): DocRow[] {
  return docs.map((d) => ({
    id: d.id,
    number: d.number,
    date: (d[dateKey] as string | undefined) ?? null,
    status: d.status,
    total: d[amountKey] ?? '0',
    remaining: d.remaining,
  }));
}

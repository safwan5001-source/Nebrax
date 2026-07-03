'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Phone, MapPin, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatRiyal, isNegative } from '@/lib/money';
import { cn } from '@/lib/utils';

interface Row { date: string; number: string; description: string | null; debit: string; credit: string; balance: string }
interface Statement {
  partner: { id: string; name: string; type: string };
  opening_balance: string;
  rows: Row[];
  closing_balance: string;
}
interface Partner {
  id: string; code: string | null; type: string; entity_type: string; name: string; name_en: string | null;
  vat_number: string | null; cr_number: string | null; email: string | null;
  phone: string | null; mobile: string | null;
  address: string | null; city: string | null;
  building_no: string | null; street: string | null; district: string | null;
  postal_code: string | null; country: string | null;
  classification: string | null; credit_limit: string | null; credit_period: number | null;
  is_active: boolean;
}

export default function PartnerStatementPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('partnerStatement');
  const tp = useTranslations('partners');

  const [data, setData] = useState<Statement | null>(null);
  const [partner, setPartner] = useState<Partner | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api<Statement>(`/reports/partner-statement/${id}`).then(setData),
      api<Partner>(`/partners/${id}`).then(setPartner).catch(() => setPartner(null)),
    ]).finally(() => setLoading(false));
  }, [id]);

  const amount = (v: string) => (
    <span className={cn('num', isNegative(v) && 'text-negative')}>{formatRiyal(v)}</span>
  );

  // استخدام الحد الائتماني: رصيد العميل المدين (ما علينا تحصيله) مقابل الحد.
  const limit = partner?.credit_limit != null ? Number(partner.credit_limit) : null;
  const used = data ? Math.max(0, Number(data.closing_balance)) : 0;
  const available = limit != null ? limit - used : null;
  const usagePct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  const addressLine = partner
    ? [partner.building_no, partner.street, partner.district, partner.city, partner.postal_code, partner.country]
        .filter(Boolean).join('، ')
    : '';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/partners')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="text-xl font-semibold text-text">{data?.partner.name ?? '…'}</h1>
        {data && <Badge tone="neutral">{tp(data.partner.type)}</Badge>}
        {partner?.entity_type && <Badge tone="muted">{tp(partner.entity_type)}</Badge>}
        {partner?.classification && <Badge tone="muted">{partner.classification}</Badge>}
      </div>

      {/* بطاقة بيانات العميل */}
      {loading && !partner ? (
        <Skeleton className="h-32 w-full" />
      ) : partner && (
        <Card>
          <CardHeader><CardTitle>{t('profile')}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {/* التواصل */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted"><Phone className="h-3.5 w-3.5" strokeWidth={1.8} />{t('contact')}</div>
                <Field label={tp('phone')} value={partner.phone} dir="ltr" />
                <Field label={tp('mobile')} value={partner.mobile} dir="ltr" />
                <Field label={tp('email')} value={partner.email} dir="ltr" />
              </div>

              {/* العنوان الوطني */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted"><MapPin className="h-3.5 w-3.5" strokeWidth={1.8} />{t('address_block')}</div>
                {partner.address && <p className="text-sm text-text">{partner.address}</p>}
                <p className="text-sm text-text">{addressLine || t('not_set')}</p>
              </div>

              {/* الحساب + الحد الائتماني */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted"><Wallet className="h-3.5 w-3.5" strokeWidth={1.8} />{t('account_block')}</div>
                <Field label={tp('vat_number')} value={partner.vat_number} dir="ltr" />
                <Field label={tp('code')} value={partner.code} dir="ltr" />
                {partner.credit_period != null && (
                  <Field label={t('credit_period')} value={`${partner.credit_period} ${t('days')}`} />
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted">{t('credit_limit')}</span>
                  <span className="num font-medium text-text">{limit != null ? formatRiyal(partner.credit_limit) : t('no_limit')}</span>
                </div>
                {limit != null && limit > 0 && (
                  <div className="space-y-1 pt-0.5">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                      <div
                        className={cn('h-full rounded-full', usagePct >= 100 ? 'bg-negative' : usagePct >= 80 ? 'bg-warning' : 'bg-primary')}
                        style={{ width: `${usagePct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-muted">
                      <span>{t('credit_used')}: <span className="num">{formatRiyal(String(used))}</span></span>
                      <span>{t('credit_available')}: <span className={cn('num', available != null && available < 0 && 'text-negative')}>{formatRiyal(String(available ?? 0))}</span></span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('title')}</CardTitle>
          {data && (
            <div className="text-sm">
              <span className="text-muted">{t('closing')}: </span>
              <span className="num font-semibold text-text">{formatRiyal(data.closing_balance)}</span>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {loading || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t('date')}</TH>
                  <TH>{t('number')}</TH>
                  <TH>{t('description')}</TH>
                  <TH className="text-end">{t('debit')}</TH>
                  <TH className="text-end">{t('credit')}</TH>
                  <TH className="text-end">{t('balance')}</TH>
                </TR>
              </THead>
              <TBody>
                <TR className="text-muted">
                  <TD />
                  <TD />
                  <TD>{t('opening')}</TD>
                  <TD />
                  <TD />
                  <TD className="text-end">{amount(data.opening_balance)}</TD>
                </TR>
                {data.rows.map((r, i) => (
                  <TR key={i}>
                    <TD className="num text-muted">{r.date}</TD>
                    <TD className="num">{r.number}</TD>
                    <TD>{r.description ?? '—'}</TD>
                    <TD className="num text-end">{r.debit !== '0.00' ? formatRiyal(r.debit) : '—'}</TD>
                    <TD className="num text-end">{r.credit !== '0.00' ? formatRiyal(r.credit) : '—'}</TD>
                    <TD className="text-end">{amount(r.balance)}</TD>
                  </TR>
                ))}
                {data.rows.length === 0 && (
                  <TR>
                    <TD colSpan={6} className="py-8 text-center text-muted">
                      {t('empty')}
                    </TD>
                  </TR>
                )}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, dir }: { label: string; value: string | null | undefined; dir?: 'ltr' | 'rtl' }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-text" dir={dir}>{value}</span>
    </div>
  );
}

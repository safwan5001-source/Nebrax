'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionItem } from '@/components/ui/accordion';
import { ActionGroup, type PageAction } from './action-group';
import { cn } from '@/lib/utils';

export interface DetailSection {
  id: string;
  title: string;
  /** عدّاد بجانب العنوان (عدد المرفقات، التخصيصات…). */
  count?: number;
  content: React.ReactNode;
}

/**
 * صفحة تفاصيل مستند مالي — **ليست نموذجاً معطّلاً**.
 *
 * الترتيب مقصود: الرقم والحالة أولاً (بهما يتعرّف المحاسب على المستند)، ثم
 * الإجراءات المسموحة، ثم شريط الملخّص المالي، ثم أقسام المستند.
 *
 * القسمة بين المقاسين ليست تجميلاً: على الجوال أقسامٌ مطويّة بقسمٍ واحد مفتوح
 * (المستند أطول من الشاشة، وفتح كل شيء يعني تمريراً بلا نهاية)، وعلى الديسكتوب
 * الأقسام مبسوطة والملخّص لاصقٌ في عمود جانبي يبقى مرئياً أثناء قراءة التفاصيل.
 */
export function DetailPage({
  backHref,
  backLabel,
  title,
  badges,
  meta,
  actions,
  actionsSlot,
  alert,
  summaryTitle,
  summary,
  sections,
  children,
  className,
}: {
  backHref: string;
  backLabel: string;
  title: React.ReactNode;
  /** شارات الحالة بجانب العنوان — نصّ لا لون فقط. */
  badges?: React.ReactNode;
  /** سطر السياق تحت العنوان (التاريخ، حالة القيد…). */
  meta?: React.ReactNode;
  actions?: PageAction[];
  actionsSlot?: React.ReactNode;
  /** خطأ إجراء أو تحذير حالة، فوق المحتوى مباشرة. */
  alert?: React.ReactNode;
  summaryTitle?: string;
  /** الملخّص المالي: عمودٌ لاصق على الديسكتوب، وآخر قسمٍ مطويّ على الجوال. */
  summary?: React.ReactNode;
  sections?: DetailSection[];
  /** محتوى حرّ أسفل الأقسام (بطاقات مرتبطة، سجلّات…). */
  children?: React.ReactNode;
  className?: string;
}) {
  const t = useTranslations('nebrax');
  const list = sections ?? [];
  const [openId, setOpenId] = React.useState<string | null>(list[0]?.id ?? (summary ? 'summary' : null));

  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id));
  const hasActions = (actions && actions.length > 0) || actionsSlot;

  return (
    <div className={cn('mx-auto max-w-5xl space-y-5', className)}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Button asChild variant="ghost" size="icon" className="no-print shrink-0" aria-label={backLabel || t('back')}>
            <Link href={backHref}>
              <ArrowRight className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
            </Link>
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="num text-xl font-semibold text-text">{title}</h1>
              {badges}
            </div>
            {meta ? <div className="mt-1 text-sm leading-relaxed text-muted">{meta}</div> : null}
          </div>
        </div>
        {hasActions ? (
          <div className="no-print flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            {actions && actions.length > 0 ? <ActionGroup actions={actions} /> : null}
            {actionsSlot}
          </div>
        ) : null}
      </header>

      {alert}

      {list.length > 0 || summary ? (
        <>
          <Accordion className="lg:hidden">
            {list.map((section) => (
              <AccordionItem
                key={section.id}
                id={section.id}
                title={section.title}
                count={section.count}
                open={openId === section.id}
                onToggle={() => toggle(section.id)}
              >
                {section.content}
              </AccordionItem>
            ))}
            {summary ? (
              <AccordionItem
                id="summary"
                title={summaryTitle ?? t('summary')}
                open={openId === 'summary'}
                onToggle={() => toggle('summary')}
              >
                {summary}
              </AccordionItem>
            ) : null}
          </Accordion>

          <div
            className={cn(
              'hidden gap-5 lg:grid',
              summary ? 'lg:grid-cols-[minmax(0,1fr)_18rem]' : 'lg:grid-cols-1'
            )}
          >
            <div className="min-w-0 space-y-5">
              {list.map((section) => (
                <Card key={section.id}>
                  <CardHeader>
                    <CardTitle>{section.title}</CardTitle>
                  </CardHeader>
                  <CardContent>{section.content}</CardContent>
                </Card>
              ))}
            </div>
            {summary ? (
              <Card className="h-fit lg:sticky lg:top-5">
                <CardHeader>
                  <CardTitle>{summaryTitle ?? t('summary')}</CardTitle>
                </CardHeader>
                <CardContent>{summary}</CardContent>
              </Card>
            ) : null}
          </div>
        </>
      ) : null}

      {children}
    </div>
  );
}

export interface DetailSummaryRow {
  label: React.ReactNode;
  /** مبلغٌ منسَّق مسبقاً عبر `formatRiyal` — لا يُنسَّق هنا. */
  value: React.ReactNode;
  /** السطر الحاسم (الإجمالي) — أكبر وأثقل. */
  strong?: boolean;
}

/**
 * أسطر الملخّص المالي. المبالغ بخط Mono ومحاذاة نهاية منطقية، والتنسيق يأتي جاهزاً
 * من `formatRiyal` — لا يُكتب رمز عملة هنا ولا في أي مستهلك.
 */
export function DetailSummary({
  rows,
  note,
  className,
}: {
  rows: DetailSummaryRow[];
  /** ملاحظة محاسبية أسفل الأرقام (أثر الترحيل، ثبات المستند…). */
  note?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-3', className)}>
      <dl className="space-y-3">
        {rows.map((row, index) => (
          <div
            key={index}
            className={cn(
              'flex items-baseline justify-between gap-4',
              row.strong ? 'border-t border-border pt-3' : undefined
            )}
          >
            <dt className={cn('text-sm', row.strong ? 'font-semibold text-text' : 'text-muted')}>{row.label}</dt>
            <dd className={cn('num text-end', row.strong ? 'text-lg font-bold text-text' : 'text-sm text-text')}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {note ? <div className="rounded-md bg-muted/50 px-3 py-3 text-xs leading-5 text-muted">{note}</div> : null}
    </div>
  );
}

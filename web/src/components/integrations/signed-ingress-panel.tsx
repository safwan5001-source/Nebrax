'use client';

import { useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatDate } from '@/lib/formatting';
import { branchLabel, type IngressPoint } from '@/lib/signed-ingress';
import { IngressManagementLayer } from './ingress-management-layer';
import { IngressCreateEntry, type IngressProfileSupport } from './ingress-create-entry';
import { IngressRowActions, useCanCreateIngress, useCanManageIngress, useCanReassignIngress } from './ingress-row-actions';
import type { IngressManagement } from './use-ingress-management';
import type { SignedIngressState } from './use-signed-ingress';

/**
 * لوحة نقاط الاستقبال الموقّعة للقراءة فقط (INT-UX-4، قرار DP-C خيار 2 لهذه الشريحة وحدها).
 *
 * تعرض ما هُيّئ فعلاً داخل أَوْج لاستقبال أحداث موقّعة من منصة، **ولا تدّعي اتصالاً بالمنصة**: لا «متصل» ولا
 * «مرتبط» ولا «مزامنة»، ولا لون أخضر لحالة النقطة (الأخضر يُحجز لحالة فعلية مُثبتة). حالة النقطة (مهيّأة/معطّلة)
 * غير جاهزية المنصة، وهذا مكتوب في اللوحة. الفرع المعروض وجهة توجيه فقط، لا ربط متجر المزوّد بفرع.
 *
 * بلا خاصية `management` (الافتراضي) لا زر في اللوحة سوى «إعادة المحاولة». ومع `management` (INT-UX-5b) يظهر لمن يحق له
 * وحده **تدوير السر** و**تعطيل** النقطة المهيّأة؛ لا إنشاء ولا إعادة إسناد ولا إعادة تفعيل ولا اختبار. ولا تُعرض قيمة سرّ
 * (إلا في حوار الكشف لمرة واحدة بعد التدوير) ولا بادئته ولا معرّف النقطة ولا أسماء المشغّلين (انظر `lib/signed-ingress.ts`).
 */
export function SignedIngressPanel({
  platformName,
  state,
  onRetry,
  management,
  profile,
}: {
  platformName: string;
  state: SignedIngressState;
  onRetry: () => void;
  /** ملف الإسناد اليدوي للمنصة (INT-UX-5c): بدونه لا مدخل إنشاء. */
  profile?: IngressProfileSupport;
  /** إدارة التدوير والتعطيل (INT-UX-5b). غيابها = لوحة قراءة فقط كما كانت. */
  management?: IngressManagement;
}) {
  const t = useTranslations('integrationCenter.ingressPanel');
  const canManage = useCanManageIngress() && management !== undefined;
  const canReassign = useCanReassignIngress() && management !== undefined;
  const canSeeActions = canManage || canReassign;
  const canCreate = useCanCreateIngress() && management !== undefined && profile !== undefined;

  const observe = management?.observe;
  // اللوحة تُبلّغ الإدارة بكل حالة قراءة: تحفظ المعروف، وتُسوّي إنشاءً مجهولاً بعد إعادة القراءة.
  useEffect(() => {
    observe?.(state);
  }, [observe, state]);

  // لا صلاحية عرض (أو الصفحة لم تُتح): اللوحة غائبة لا معطّلة، بلا طلب.
  if (state.status === 'idle') return null;

  return (
    <section aria-labelledby="signed-ingress-heading" className="space-y-3 rounded-md border border-border bg-surface p-4" data-testid="signed-ingress-panel" data-state={state.status}>
      <header className="space-y-1">
        <h2 id="signed-ingress-heading" className="text-sm font-semibold text-text">{t('title')}</h2>
        <p className="text-sm leading-relaxed text-muted">{t('intro', { platform: platformName })}</p>
      </header>

      {/* الإشعار والحوارات أعلى القائمة: نتيجة العملية (خصوصاً «السرّ ضاع») يجب أن تُرى على الجوال دون تمرير. الحوارات ثابتة الموضع فلا يتأثر موضعها. */}
      {management ? <IngressManagementLayer management={management} platformName={platformName} /> : null}

      {canCreate && (state.status === 'ready') && management && profile ? (
        <IngressCreateEntry profile={profile} management={management} platformName={platformName} />
      ) : null}

      {state.status === 'loading' ? (
        <div role="status" aria-busy="true" aria-label={t('loading')} className="space-y-2" data-testid="signed-ingress-loading">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : state.status === 'forbidden' ? (
        <p role="note" className="rounded border border-dashed border-border px-3 py-2 text-sm leading-relaxed text-muted" data-testid="signed-ingress-forbidden">{t('forbidden')}</p>
      ) : state.status === 'error' ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-2 text-sm text-negative" data-testid="signed-ingress-error">
          <span>{t('error')}</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>{t('retry')}</Button>
        </div>
      ) : state.points.length === 0 ? (
        <div className="space-y-1 rounded border border-dashed border-border px-3 py-3" data-testid="signed-ingress-empty">
          <p className="text-sm font-medium text-text">{t('empty.title', { platform: platformName })}</p>
          <p className="text-sm leading-relaxed text-muted">{t('empty.body')}</p>
        </div>
      ) : (
        <IngressRows points={state.points} canViewBranches={state.canViewBranches} branchNames={state.branchNames} management={canSeeActions ? management : undefined} showOperator={canReassign} />
      )}

      <div className="space-y-1 text-xs leading-relaxed text-muted" data-testid="signed-ingress-notes">
        <p>{t('statusNote')}</p>
        <p>{t('branchNote')}</p>
        <p>{t('scopeNote')}</p>
        <p data-testid={canManage ? 'signed-ingress-manage-note' : canReassign ? 'signed-ingress-reassign-note' : 'signed-ingress-readonly-note'}>{canManage ? t('manageNote') : canReassign ? t('reassignNote') : t('readOnlyNote')}</p>
      </div>
    </section>
  );
}

function IngressRows({
  points,
  canViewBranches,
  branchNames,
  management,
  showOperator = false,
}: {
  points: IngressPoint[];
  canViewBranches: boolean;
  branchNames: Map<string, string> | null;
  management?: IngressManagement;
  /** عمود/سطر «المشغّل المسؤول» لمن يملك reassign + users.view فقط (اسم لا معرّف). */
  showOperator?: boolean;
}) {
  const t = useTranslations('integrationCenter.ingressPanel');
  const locale = useLocale();
  const operatorText = (point: IngressPoint): string => {
    const name = management?.currentOperatorName(point);
    if (name) return name;
    return management?.operators.status === 'loading' ? t('operator.loading') : t('operator.unknown');
  };

  const branchText = (point: IngressPoint): string => {
    const label = branchLabel(point, canViewBranches, branchNames);
    return label.kind === 'named' ? label.name : t(`branch.${label.kind}`);
  };
  const statusBadge = (point: IngressPoint) => (
    <Badge tone={point.status === 'configured' ? 'neutral' : 'muted'} data-testid="signed-ingress-status" data-status={point.status}>
      {t(`status.${point.status}`)}
    </Badge>
  );
  const created = (point: IngressPoint) => (point.createdAt ? formatDate(point.createdAt, locale) : t('unknownDate'));
  const disabledOn = (point: IngressPoint) => (point.status === 'disabled' && point.disabledAt ? t('disabledOn', { date: formatDate(point.disabledAt, locale) }) : null);

  return (
    <>
      <div className="hidden md:block" data-testid="signed-ingress-table">
        <div className="rounded border border-border">
          <Table>
            <caption className="sr-only">{t('caption')}</caption>
            <THead>
              <TR>
                <TH scope="col">{t('columns.storeId')}</TH>
                <TH scope="col">{t('columns.branch')}</TH>
                <TH scope="col">{t('columns.status')}</TH>
                <TH scope="col">{t('columns.version')}</TH>
                {showOperator ? <TH scope="col">{t('columns.operator')}</TH> : null}
                <TH scope="col">{t('columns.created')}</TH>
                {management ? <TH scope="col"><span className="sr-only">{t('columns.actions')}</span></TH> : null}
              </TR>
            </THead>
            <TBody>
              {points.map((point) => (
                <TR key={point.id} data-testid="signed-ingress-row">
                  <TD><span className="num break-all" dir="ltr">{point.storeId}</span></TD>
                  <TD>{branchText(point)}</TD>
                  <TD>
                    <div className="flex flex-col items-start gap-0.5">
                      {statusBadge(point)}
                      {disabledOn(point) ? <span className="text-xs text-muted">{disabledOn(point)}</span> : null}
                    </div>
                  </TD>
                  <TD><span className="num">{point.secretVersion}</span></TD>
                  {showOperator ? <TD data-testid="signed-ingress-operator">{operatorText(point)}</TD> : null}
                  <TD>{created(point)}</TD>
                  {management ? <TD className="text-end"><IngressRowActions point={point} management={management} /></TD> : null}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </div>

      <ul className="space-y-2 md:hidden" role="list" data-testid="signed-ingress-cards">
        {points.map((point) => (
          <li key={point.id} className="rounded border border-border p-3" data-testid="signed-ingress-row">
            <div className="flex items-start justify-between gap-2">
              <span className="num min-w-0 break-all text-sm font-medium text-text" dir="ltr">{point.storeId}</span>
              {statusBadge(point)}
            </div>
            <dl className="mt-2 divide-y divide-border text-xs">
              <div className="flex items-start justify-between gap-3 py-1.5">
                <dt className="text-muted">{t('columns.branch')}</dt>
                <dd className="min-w-0 text-end text-text">{branchText(point)}</dd>
              </div>
              <div className="flex items-start justify-between gap-3 py-1.5">
                <dt className="text-muted">{t('columns.version')}</dt>
                <dd className="num text-text">{point.secretVersion}</dd>
              </div>
              {showOperator ? (
                <div className="flex items-start justify-between gap-3 py-1.5">
                  <dt className="text-muted">{t('columns.operator')}</dt>
                  <dd className="min-w-0 text-end text-text" data-testid="signed-ingress-operator">{operatorText(point)}</dd>
                </div>
              ) : null}
              <div className="flex items-start justify-between gap-3 py-1.5">
                <dt className="text-muted">{t('columns.created')}</dt>
                <dd className="text-end text-text">{created(point)}</dd>
              </div>
              {disabledOn(point) ? (
                <div className="py-1.5 text-muted">{disabledOn(point)}</div>
              ) : null}
            </dl>
            {management ? <div className="mt-2 empty:hidden"><IngressRowActions point={point} management={management} /></div> : null}
          </li>
        ))}
      </ul>
    </>
  );
}

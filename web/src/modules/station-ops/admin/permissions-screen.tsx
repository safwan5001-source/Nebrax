'use client';

import { useLocale, useTranslations } from 'next-intl';
import { LockKeyhole } from 'lucide-react';
import { useStationOps } from '../context';
import { PageMasthead, ScreenBody } from '../masthead';
import { StationOpsError } from '../read-client';
import { ErrorState, LoadingBlock } from '../state-views';
import { STAFF_PERMISSION, useTemplates } from './data';
import { groupPermissions } from './editing';
import { usePermissionLabel } from './labels';
import { MANAGE_BASE } from './manage-screen';
import { Badge } from './ui';

/**
 * مرجع الصلاحيات (قراءة فقط): ماذا يمنح كل قالب، وما الذي يستطيع هذا المسؤول تفويضه، وما المحجوز. لا تعديل هنا — التعديل من شاشة الموظف.
 */
export function PermissionsScreen() {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const { can } = useStationOps();
  const label = usePermissionLabel();
  const templates = useTemplates();

  return (
    <>
      <PageMasthead title={t('manage.permissions.title')} subtitle={t('manage.permissions.subtitle')} backHref={MANAGE_BASE} backLabel={t('manage.back')} />
      <ScreenBody>
        {!can(STAFF_PERMISSION) ? <ErrorState error={new StationOpsError('forbidden', 403)} /> : null}
        {can(STAFF_PERMISSION) && templates.state.status === 'loading' ? <LoadingBlock rows={3} /> : null}
        {can(STAFF_PERMISSION) && templates.state.status === 'error' ? <ErrorState error={templates.state.error} onRetry={templates.reload} /> : null}

        {templates.state.status === 'success' && can(STAFF_PERMISSION) ? (() => {
          const data = templates.state.data;
          return (
          <>
            <ul className="space-y-3">
              {data.templates.map((template) => (
                <li key={template.key}>
                  <details className="rounded-[14px] border border-border bg-surface">
                    <summary className="flex min-h-[64px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                      <span className="min-w-0">
                        <span className="block text-base font-semibold text-text">{locale === 'ar' ? template.label_ar : template.label_en}</span>
                        <span className="block text-xs text-muted">{t(`manage.editor.templateDesc.${template.key}`)}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {!template.assignable ? <Badge tone="warning">{t('manage.permissions.notAssignable')}</Badge> : null}
                        <span className="num text-sm text-muted">{template.permissions.length}</span>
                      </span>
                    </summary>
                    <div className="space-y-3 border-t border-border px-4 py-3">
                      {groupPermissions(template.permissions).map((group) => (
                        <div key={group.id}>
                          <p className="text-sm font-semibold text-text">{t(`manage.group.${group.id}`)}</p>
                          <ul className="mt-1 space-y-0.5">
                            {group.keys.map((key) => <li key={key} className="text-sm leading-6 text-muted">{label(key)}</li>)}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </details>
                </li>
              ))}
            </ul>

            <section aria-labelledby="mg-res-h" className="space-y-2 rounded-[14px] border border-border bg-surface p-4">
              <h2 id="mg-res-h" className="flex items-center gap-2 text-base font-semibold text-text"><LockKeyhole aria-hidden="true" className="h-4 w-4" strokeWidth={1.9} />{t('manage.permissions.reservedTitle')}</h2>
              <p className="text-sm leading-6 text-muted">{t('manage.permissions.reservedBody')}</p>
              <ul className="space-y-0.5">{data.reserved.map((key) => <li key={key} className="text-sm leading-6 text-text">{label(key)}</li>)}</ul>
            </section>

            <p className="num text-sm text-muted">{t('manage.permissions.delegableCount', { count: data.delegable.filter((key) => !data.reserved.includes(key)).length, total: data.catalog.length })}</p>
          </>
          );
        })() : null}
      </ScreenBody>
    </>
  );
}

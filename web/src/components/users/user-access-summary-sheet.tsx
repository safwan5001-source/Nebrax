'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { displayLocale } from '@/lib/formatting';
import { useCan } from '@/lib/use-can';
import { useRestoreFocus } from '@/lib/use-restore-focus';
import type { RoleSummary, ScopeOption, UserRecord } from '@/modules/users/model';
import { buildAccessSummary, type RoleKind, type ScopeDetail } from '@/modules/users/summary';

const SECTION = 'space-y-2 border-t border-border pt-4 first:border-t-0 first:pt-0';
const SYSTEM_ROLE_SLUGS = ['owner', 'admin', 'accountant', 'staff', 'self_service'] as const;

/**
 * ملخّص وصول المستخدم (AC-UX-08): لوحة قراءة فقط من **الإسنادات المصدرية** — حالة الدخول، الدور، الفروع،
 * المستودعات، الموظف المرتبط. لا تحسب «وصولاً فعلياً»، وتقول ذلك صراحةً. القوائم المرجعية (أدوار/فروع/
 * مستودعات) تأتي ممّا حمّلته الصفحة أصلاً بصلاحياتها المستقلة (D-J): غيابها يُسقط الملخّص إلى الأعداد
 * وإلى أسماء الأدوار النظامية بلا اختلاق.
 */
export function UserAccessSummarySheet({
  user,
  onClose,
  onEdit,
  roles,
  branches,
  warehouses,
  isSelf,
}: {
  user: UserRecord;
  onClose: () => void;
  /** غيابه = لا زر تعديل (المشاهد بلا `users.manage` أو الصف غير قابل للتعديل). */
  onEdit?: () => void;
  roles: RoleSummary[] | null;
  branches: ScopeOption[] | null;
  warehouses: ScopeOption[] | null;
  isSelf: boolean;
}) {
  const t = useTranslations('users');
  const tr = useTranslations('rolesPage');
  const locale = displayLocale(useLocale());
  const { can } = useCan();
  const restoreFocus = useRestoreFocus();
  const num = (n: number) => n.toLocaleString(locale);

  const systemNames = useMemo(
    () => Object.fromEntries(SYSTEM_ROLE_SLUGS.map((slug) => [slug, t(`roles.${slug}`)])),
    [t],
  );
  const summary = useMemo(
    () => buildAccessSummary(user, { roles, branches, warehouses, systemNames, locale }),
    [user, roles, branches, warehouses, systemNames, locale],
  );

  const kindLabel = (kind: RoleKind | null): string | null => {
    if (kind === 'owner') return t('access_summary_role_owner');
    if (kind === 'system') return tr('kind_system');
    if (kind === 'custom') return tr('kind_custom');
    return null;
  };

  const roleName = summary.role.label.kind === 'name' ? summary.role.label.name : t('role_custom');
  const kind = kindLabel(summary.role.kind);

  const scopeBlock = (scope: ScopeDetail, dimension: 'branches' | 'warehouses') => {
    if (scope.kind === 'all') {
      return <p className="text-sm text-text">{t(`access_summary_${dimension}_all`)}</p>;
    }
    if (scope.kind === 'count') {
      return (
        <>
          <p className="text-sm text-text">{t(`access_summary_${dimension}_limited_count`, { n: scope.count, count: num(scope.count) })}</p>
          <p className="text-xs text-muted">{t(`access_summary_${dimension}_names_need_list`)}</p>
        </>
      );
    }
    return (
      <>
        <p className="text-sm text-text">
          {t(`access_summary_${dimension}_limited_count`, { n: scope.names.length + scope.hidden, count: num(scope.names.length + scope.hidden) })}
        </p>
        {scope.names.length > 0 ? (
          <ul className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto" aria-label={t(dimension === 'branches' ? 'col_branches' : 'col_warehouses')}>
            {scope.names.map((name) => (
              <li key={name} className="rounded border border-border bg-background px-2 py-0.5 text-xs text-text">
                <bdi>{name}</bdi>
              </li>
            ))}
          </ul>
        ) : null}
        {scope.hidden > 0 ? (
          <p className="text-xs text-muted">{t('access_summary_scope_hidden', { n: scope.hidden, count: num(scope.hidden) })}</p>
        ) : null}
      </>
    );
  };

  return (
    <Sheet open onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent closeLabel={t('editor_close')} className="sm:max-w-md" onCloseAutoFocus={restoreFocus}>
        <header className="shrink-0 border-b border-border px-5 pb-3 pe-14 pt-4">
          <SheetTitle className="text-base font-semibold text-text">
            {t('access_summary_title')} — <bdi>{user.name}</bdi>
          </SheetTitle>
          <SheetDescription className="mt-1 text-xs leading-relaxed text-muted">
            <span className="num" dir="ltr">{user.email}</span>
            {isSelf ? <> · {t('you')}</> : null}
          </SheetDescription>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <section className={SECTION} aria-labelledby="uas-signin">
            <h3 id="uas-signin" className="text-sm font-semibold text-text">{t('access_summary_signin')}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={summary.signIn === 'allowed' ? 'positive' : 'muted'}>
                {summary.signIn === 'allowed' ? t('active') : t('inactive')}
              </Badge>
              <span className="text-sm text-text">
                {summary.signIn === 'allowed' ? t('access_summary_signin_allowed') : t('access_summary_signin_blocked')}
              </span>
            </div>
          </section>

          <section className={SECTION} aria-labelledby="uas-role">
            <h3 id="uas-role" className="text-sm font-semibold text-text">{t('role')}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-text"><bdi>{roleName}</bdi></span>
              {kind ? <Badge tone="muted">{kind}</Badge> : null}
            </div>
            {summary.role.access?.kind === 'full' ? (
              <p className="text-sm text-text">{t('role_summary_full')}</p>
            ) : summary.role.access?.kind === 'count' ? (
              <p className="text-sm text-text">
                {t('role_summary_count', { n: summary.role.access.count, count: num(summary.role.access.count) })}
                {summary.role.access.sensitive > 0
                  ? ` · ${t('access_summary_sensitive', { n: summary.role.access.sensitive, count: num(summary.role.access.sensitive) })}`
                  : ''}
              </p>
            ) : (
              <p className="text-xs text-muted">{t('access_summary_role_needs_view')}</p>
            )}
            {can('roles.view') ? (
              <Link href="/roles" className="text-xs text-primary hover:underline">{t('access_summary_open_roles')}</Link>
            ) : null}
          </section>

          <section className={SECTION} aria-labelledby="uas-branches">
            <h3 id="uas-branches" className="text-sm font-semibold text-text">{t('col_branches')}</h3>
            {scopeBlock(summary.branches, 'branches')}
          </section>

          <section className={SECTION} aria-labelledby="uas-warehouses">
            <h3 id="uas-warehouses" className="text-sm font-semibold text-text">{t('col_warehouses')}</h3>
            {scopeBlock(summary.warehouses, 'warehouses')}
          </section>

          <section className={SECTION} aria-labelledby="uas-employee">
            <h3 id="uas-employee" className="text-sm font-semibold text-text">{t('access_summary_employee')}</h3>
            {summary.employee ? (
              can('hr.view') ? (
                <Link href={`/hr/employees/${summary.employee.id}`} className="text-sm text-primary hover:underline">
                  <bdi>{summary.employee.label}</bdi>
                </Link>
              ) : (
                <p className="text-sm text-text"><bdi>{summary.employee.label}</bdi></p>
              )
            ) : (
              <p className="text-sm text-muted">{t('access_summary_no_employee')}</p>
            )}
          </section>

          <p role="note" className="rounded border border-border bg-background px-3 py-2 text-xs leading-relaxed text-muted">
            {t('access_summary_note')}
          </p>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose}>{t('editor_close')}</Button>
          {onEdit ? <Button type="button" onClick={onEdit}>{t('edit')}</Button> : null}
        </footer>
      </SheetContent>
    </Sheet>
  );
}

'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TriangleAlert } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import {
  changeScope,
  describeAccess,
  excludesActor,
  lookupAvailable,
  subjectMissing,
  subjectOptions,
  type AccessDescription,
  type AccessLookups,
  type PermissionScope,
  type SubjectScope,
  type TreasuryAction,
} from '@/modules/treasury/access';
import type { RoleSummary } from '@/modules/users/model';

const SCOPES: PermissionScope[] = ['all', 'role', 'user', 'branch'];
const SYSTEM_ROLE_SLUGS = ['owner', 'admin', 'accountant', 'staff', 'self_service'] as const;

/** أسماء الأدوار النظامية المترجَمة — تُعرض حتى لمن لا يملك صلاحية عرض الأدوار. */
export function useSystemRoleNames(): Record<string, string> {
  const t = useTranslations('users');
  return useMemo(() => Object.fromEntries(SYSTEM_ROLE_SLUGS.map((slug) => [slug, t(`roles.${slug}`)])), [t]);
}

/**
 * قوائم اختيار المرجع (أدوار/مستخدمون/فروع)، كلٌّ خلف صلاحيتها المستقلة (D-J): بلا الصلاحية لا طلب ولا اختيار
 * جديد لذلك النطاق (والقيمة المحفوظة تبقى كما هي). `null` = غير متاحة.
 */
export function useAccessLookups(enabled: boolean): AccessLookups {
  const me = currentUser();
  const can = (permission: string) => hasPermission(me?.permissions, me?.role, permission);
  const [lookups, setLookups] = useState<AccessLookups>({ roles: null, users: null, branches: null });

  useEffect(() => {
    if (!enabled) return;
    if (can('roles.view')) api<{ data: RoleSummary[] }>('/roles').then((r) => setLookups((l) => ({ ...l, roles: r.data }))).catch(() => {});
    if (can('users.view')) {
      api<{ data: { id: string; name: string; email?: string }[] }>('/users')
        .then((r) => setLookups((l) => ({ ...l, users: r.data })))
        .catch(() => {});
    }
    if (can('branches.view')) api<{ data: { id: string; name: string }[] }>('/branches').then((r) => setLookups((l) => ({ ...l, branches: r.data }))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- تُحمَّل عند التفعيل فقط
  }, [enabled]);

  return lookups;
}

/** جملة القاعدة بلغة بسيطة: «يقتصر الإيداع على الدور «أمين الصندوق»». لا معرّف خاماً أبداً. */
export function useAccessSummary() {
  const t = useTranslations('cashBank');
  return (description: AccessDescription, action: TreasuryAction): string => {
    if (description.kind === 'all') return t('summary_all', { action });
    return description.label === null
      ? t(`summary_${description.kind}_unknown`, { action })
      : t(`summary_${description.kind}`, { action, label: description.label });
  };
}

export interface AccessRuleValue {
  scope: PermissionScope;
  subject: string;
}

/**
 * قاعدة اتجاهٍ واحد (إيداع أو سحب): من يحق له؟ — «الكل/دور/مستخدم/فرع» بوصفٍ يشرح معناها الفعلي، ومحدِّدٌ بالأسماء
 * بدل حقل نصٍّ حرّ، وجملةٌ تلخّص القاعدة، وتحذيرٌ من القفل الذاتي. الخادم هو الحاسم؛ هذا عرضٌ وتحقّقٌ مبكّر فقط.
 */
export function AccessRuleField({
  action,
  value,
  initial,
  onChange,
  lookups,
}: {
  action: TreasuryAction;
  value: AccessRuleValue;
  /** القيمة المحفوظة عند الفتح: نطاقها يبقى متاحاً حتى بلا صلاحية عرض قائمته (لا نفرضُ تغييراً لا يستطيع إتمامه). */
  initial: AccessRuleValue;
  onChange: (next: AccessRuleValue) => void;
  lookups: AccessLookups;
}) {
  const t = useTranslations('cashBank');
  const summarise = useAccessSummary();
  const systemRoleNames = useSystemRoleNames();
  const groupId = useId();
  const me = currentUser();

  const description = describeAccess(value.scope, value.subject, lookups, systemRoleNames);
  const options = subjectOptions(value.scope, lookups, systemRoleNames);
  const pickable = lookupAvailable(value.scope, lookups);
  const missing = subjectMissing(value.scope, value.subject);
  const excluded = excludesActor(value.scope, value.subject, { id: me?.id ?? null, role: me?.role ?? null });
  const subjectScope = value.scope === 'all' ? null : (value.scope as SubjectScope);

  // نطاقٌ يحتاج قائمةً لا يملكها المشاهد لا يُختار جديداً؛ يبقى متاحاً إن كان هو المحفوظ أصلاً.
  const selectable = (scope: PermissionScope) => lookupAvailable(scope, lookups) || scope === initial.scope;

  const needsKey = subjectScope ? (`needs_${subjectScope === 'branch' ? 'branches' : `${subjectScope}s`}_view` as const) : null;
  const requiredKey = subjectScope ? (`subject_required_${subjectScope}` as const) : null;

  return (
    <fieldset className="space-y-3 rounded-md border border-border p-4">
      <legend className="px-1 text-sm font-medium text-text">{t(`who_${action}`)}</legend>

      <div role="radiogroup" aria-label={t(`who_${action}`)} className="space-y-2">
        {SCOPES.map((scope) => {
          const enabled = selectable(scope);
          const checked = value.scope === scope;
          return (
            <label
              key={scope}
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded border p-2.5 text-sm',
                checked ? 'border-primary bg-primary-soft' : 'border-border',
                !enabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name={`${groupId}-scope`}
                className="mt-0.5 accent-primary"
                checked={checked}
                disabled={!enabled}
                aria-labelledby={`${groupId}-${scope}-title`}
                aria-describedby={`${groupId}-${scope}-hint`}
                onChange={() => onChange(scope === initial.scope ? { scope, subject: initial.subject } : changeScope(scope))}
              />
              <span>
                <span id={`${groupId}-${scope}-title`} className="block font-medium text-text">{t(scope)}</span>
                <span id={`${groupId}-${scope}-hint`} className="block text-xs leading-relaxed text-muted">{t(`scope_${scope}_hint`)}</span>
              </span>
            </label>
          );
        })}
      </div>

      {subjectScope ? (
        <div className="space-y-1.5">
          <label htmlFor={`${groupId}-subject`} className="block text-sm text-muted">{t(`subject_${subjectScope}`)}</label>
          {pickable ? (
            <Select
              id={`${groupId}-subject`}
              value={value.subject}
              onChange={(e) => onChange({ scope: value.scope, subject: e.target.value })}
              aria-invalid={missing || undefined}
              required
            >
              <option value="">{t(`pick_${subjectScope}`)}</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
              {/* القيمة المحفوظة التي لم تعد في القائمة (محذوفة) لا تختفي بصمت: تبقى خياراً مسمّىً حتى يغيّرها المستخدم. */}
              {value.subject !== '' && !options.some((o) => o.value === value.subject) ? (
                <option value={value.subject}>{t(`current_unresolved_${subjectScope}`)}</option>
              ) : null}
            </Select>
          ) : (
            <p className="rounded border border-border px-3 py-2 text-sm text-muted">
              {description.kind !== 'all' && description.label !== null
                ? t('current_kept', { label: description.label })
                : t(`current_unresolved_${subjectScope}`)}
              {' '}
              {t(needsKey!)}
            </p>
          )}
          {missing ? <p role="alert" className="text-xs text-negative">{t(requiredKey!)}</p> : null}
        </div>
      ) : null}

      <p className="text-sm text-text" aria-live="polite">{summarise(description, action)}</p>

      {excluded ? (
        <p role="note" className="flex items-start gap-2 rounded bg-warning/10 px-3 py-2 text-xs text-warning">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden="true" />
          <span>{t(value.scope === 'role' ? 'self_excluded_role' : 'self_excluded_user', { action })}</span>
        </p>
      ) : null}
    </fieldset>
  );
}

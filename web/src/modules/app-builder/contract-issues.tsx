'use client';

import * as React from 'react';
import type { ContractIssue } from '@/lib/app-builder';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** رموز المشكلات المعروفة (عقد `contracts/app-builder/contract-issues.v1.json`)؛ رمز جديد يسقط على رسالة الخادم. */
export const KNOWN_ISSUE_CODES = [
  'page_not_root', 'child_not_allowed', 'children_not_allowed', 'prop_type_mismatch', 'prop_enum_invalid',
  'action_param_invalid', 'missing_action_param', 'navigate_target_missing',
  'tab_page_missing', 'tab_duplicate_page', 'tabs_too_many_visible',
  'duplicate_id_across_pages', 'unknown_prop', 'missing_required_prop', 'action_not_supported', 'unknown_action_param',
] as const;

const locationOf = (issue: ContractIssue): string => [issue.page_id, issue.node_id, issue.field].filter(Boolean).join(' › ');

export function issueText(issue: ContractIssue, t: Translate): string {
  return (KNOWN_ISSUE_CODES as readonly string[]).includes(issue.code) ? t(`issues.codes.${issue.code}`) : issue.message;
}

export function parseContractIssues(body: unknown): ContractIssue[] | null {
  const issues = (body as { reason?: unknown; issues?: unknown } | null)?.issues;
  if ((body as { reason?: unknown } | null)?.reason !== 'contract_violations' || !Array.isArray(issues)) return null;
  return issues.filter((i): i is ContractIssue => typeof i === 'object' && i !== null && typeof (i as ContractIssue).code === 'string');
}

/** قائمة مشكلات العقد (تُستعمل في الشريط وفي حوار النشر). */
export function ContractIssuesList({ issues, t, limit = 50, onOpen }: { issues: ContractIssue[]; t: Translate; limit?: number; onOpen?: (issue: ContractIssue) => void }) {
  const shown = issues.slice(0, limit);
  return (
    <ul className="max-h-48 space-y-1 overflow-auto text-xs">
      {shown.map((issue, index) => (
        <li key={`${issue.code}-${issue.node_id ?? ''}-${issue.field ?? ''}-${index}`} className="flex flex-wrap items-baseline gap-x-2">
          <span className={issue.blocks_publish ? 'font-medium text-negative' : 'text-muted'}>
            {issue.blocks_publish ? t('issues.blocking') : t('issues.warning')}
          </span>
          <span className="text-text">{issueText(issue, t)}</span>
          {onOpen && issue.node_id ? (
            // الاسم يضم الموضع (الصفحة › العقدة › الحقل) كي يميّز قارئ الشاشة الوجهات؛ التعليمة المترجمة في الاسم نفسه.
            <button type="button" className="text-[11px] text-primary underline" dir="ltr" aria-label={`${t('issues.open')}: ${locationOf(issue)}`} title={t('issues.open')} onClick={() => onOpen(issue)}>
              {locationOf(issue)}
            </button>
          ) : (
            <code className="text-[11px] text-muted" dir="ltr">{locationOf(issue)}</code>
          )}
        </li>
      ))}
      {issues.length > limit ? <li className="text-muted">{t('issues.more', { count: issues.length - limit })}</li> : null}
    </ul>
  );
}

/** شريط مشكلات العقد في المحرر: غائب بلا مشكلات؛ يوضّح ما سيمنع النشر. معلوماتي — لا يمنع الحفظ أبداً. */
export function ContractIssuesNotice({ issues, t, onOpen }: { issues: ContractIssue[]; t: Translate; onOpen?: (issue: ContractIssue) => void }) {
  const [open, setOpen] = React.useState(false);
  if (issues.length === 0) return null;
  const blocking = issues.filter((i) => i.blocks_publish).length;
  const warnings = issues.length - blocking;
  return (
    <div role="status" data-testid="contract-issues" className={`shrink-0 border-b px-4 py-2 text-xs ${blocking > 0 ? 'border-negative/30 bg-negative/10' : 'border-border bg-primary-soft'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text">
          {blocking > 0 ? t('issues.summaryBlocking', { blocking, warnings }) : t('issues.summaryWarnings', { warnings })}
        </span>
        <button type="button" className="text-primary underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t('issues.hide') : t('issues.show')}
        </button>
      </div>
      {open ? <div className="mt-2"><ContractIssuesList issues={issues} t={t} onOpen={onOpen} /></div> : null}
    </div>
  );
}

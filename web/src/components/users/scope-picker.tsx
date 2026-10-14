'use client';

import { useId, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { displayLocale } from '@/lib/formatting';
import {
  hiddenIds,
  toggleId,
  type ScopeDraft,
  type ScopeIssue,
} from '@/modules/users/editor';

export interface PickerOption {
  id: string;
  name: string;
  code?: string;
  /** سياقٌ ثانوي (مثلاً فرع المستودع) يُعرض بلون خافت. */
  context?: string;
}

type Kind = 'branches' | 'warehouses';

/**
 * محرّر نطاق وصول لبُعدٍ واحد (فروع أو مستودعات): «الكل» أو «محدَّد».
 *
 * هو الواجهة الوحيدة لهذا المعنى — ليس فيه قائمةُ صلاحيات ولا يحسب شيئاً: يقرأ ويكتب الإسناد
 * المصدري فقط. «الكل» = إسنادٌ فارغ (غير مقيَّد)، ولا توجد حالة «لا شيء».
 */
export function ScopePicker({
  kind,
  draft,
  onChange,
  options,
  editable,
  actorRestricted,
  issue,
}: {
  kind: Kind;
  draft: ScopeDraft;
  onChange: (next: ScopeDraft) => void;
  /** `null` = قيد التحميل. */
  options: PickerOption[] | null;
  /** يملك المشاهد صلاحية عرض القائمة؟ بدونها يُعرض البُعد للقراءة فقط (D-J). */
  editable: boolean;
  /** هذا البُعد مقيَّد عند الفاعل نفسه ⇒ لا يملك منح «الكل» (سقف AC-UX-00A). */
  actorRestricted: boolean;
  issue: ScopeIssue | null;
}) {
  const t = useTranslations('users');
  const locale = displayLocale(useLocale());
  const groupId = useId();
  const [query, setQuery] = useState('');
  const num = (n: number) => n.toLocaleString(locale);

  const noun = kind === 'branches' ? 'branches' : 'warehouses';
  const hidden = hiddenIds(draft.ids, options);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!options) return [];
    if (!needle) return options;
    return options.filter((o) => `${o.name} ${o.code ?? ''} ${o.context ?? ''}`.toLocaleLowerCase().includes(needle));
  }, [options, query]);

  if (!editable) {
    return (
      <p className="rounded border border-border px-3 py-2 text-sm text-muted">
        {draft.mode === 'all'
          ? t(kind === 'branches' ? 'scope_all_branches' : 'scope_all_warehouses')
          : t('scope_read_only_count', { count: num(draft.ids.length) })}
        {' — '}
        {t(kind === 'branches' ? 'scope_needs_branches_view' : 'scope_needs_warehouses_view')}
      </p>
    );
  }

  const allDisabled = actorRestricted;
  const selectedCount = draft.ids.filter((id) => options?.some((o) => o.id === id)).length;
  const setMode = (mode: 'all' | 'selected') => onChange({ ...draft, mode });

  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label={t(`scope_${noun}`)} className="grid gap-2 sm:grid-cols-2">
        <label
          className={`flex cursor-pointer items-start gap-2 rounded border p-3 text-sm ${draft.mode === 'all' ? 'border-primary bg-primary-soft' : 'border-border'} ${allDisabled ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          <input
            type="radio"
            name={`${groupId}-mode`}
            className="mt-0.5 accent-primary"
            checked={draft.mode === 'all'}
            disabled={allDisabled}
            onChange={() => setMode('all')}
          />
          <span>
            <span className="block font-medium text-text">{t(kind === 'branches' ? 'scope_all_branches' : 'scope_all_warehouses')}</span>
            <span className="block text-xs leading-relaxed text-muted">{t(`mode_all_${noun}_hint`)}</span>
          </span>
        </label>
        <label
          className={`flex cursor-pointer items-start gap-2 rounded border p-3 text-sm ${draft.mode === 'selected' ? 'border-primary bg-primary-soft' : 'border-border'}`}
        >
          <input
            type="radio"
            name={`${groupId}-mode`}
            className="mt-0.5 accent-primary"
            checked={draft.mode === 'selected'}
            onChange={() => setMode('selected')}
          />
          <span>
            <span className="block font-medium text-text">{t(`mode_selected_${noun}`)}</span>
            <span className="block text-xs leading-relaxed text-muted">{t(`mode_selected_${noun}_hint`)}</span>
          </span>
        </label>
      </div>

      {allDisabled ? <p className="text-xs text-muted">{t(`scope_all_not_allowed_${noun}`)}</p> : null}

      {draft.mode === 'selected' ? (
        <div className="space-y-2 rounded border border-border p-2">
          {options === null ? (
            <p className="px-1 py-2 text-xs text-muted">{t('scope_loading')}</p>
          ) : options.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted">{t('scope_none')}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" strokeWidth={1.7} aria-hidden="true" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t(`scope_search_${noun}`)}
                    aria-label={t(`scope_search_${noun}`)}
                    className="h-8 ps-8 text-xs"
                  />
                </div>
                <button
                  type="button"
                  className="h-8 rounded px-2 text-xs text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  onClick={() => onChange({ ...draft, ids: Array.from(new Set([...draft.ids, ...visible.map((o) => o.id)])) })}
                  disabled={visible.length === 0}
                >
                  {t('scope_select_all')}
                </button>
                <button
                  type="button"
                  className="h-8 rounded px-2 text-xs text-muted hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  onClick={() => {
                    const clear = new Set(visible.map((o) => o.id));
                    onChange({ ...draft, ids: draft.ids.filter((id) => !clear.has(id)) });
                  }}
                  disabled={visible.length === 0}
                >
                  {t('scope_clear')}
                </button>
              </div>

              <ul className="max-h-48 space-y-0.5 overflow-y-auto" aria-label={t(`scope_${noun}`)}>
                {visible.length === 0 ? (
                  <li className="px-1 py-2 text-xs text-muted">{t('scope_no_match')}</li>
                ) : (
                  visible.map((o) => (
                    <li key={o.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-sm hover:bg-primary-soft">
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={draft.ids.includes(o.id)}
                          onChange={() => onChange({ ...draft, ids: toggleId(draft.ids, o.id) })}
                        />
                        <span className="min-w-0 truncate">{o.name}</span>
                        {o.code ? <span className="num shrink-0 text-xs text-muted">{o.code}</span> : null}
                        {o.context ? <span className="ms-auto shrink-0 text-xs text-muted">{o.context}</span> : null}
                      </label>
                    </li>
                  ))
                )}
              </ul>

              <p className="px-1 text-xs text-muted" aria-live="polite">
                {t('scope_selected_count', { selected: num(selectedCount), total: num(options.length) })}
              </p>
            </>
          )}
        </div>
      ) : null}

      {draft.mode === 'selected' && hidden > 0 ? (
        <p className="text-xs text-muted">{t('scope_hidden_note', { n: hidden, count: num(hidden) })}</p>
      ) : null}
      {issue === 'selected_empty' ? (
        <p role="alert" className="text-xs text-negative">{t(`scope_selected_empty_${noun}`)}</p>
      ) : null}
    </div>
  );
}

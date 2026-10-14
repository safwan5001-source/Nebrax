'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Search, ShieldAlert } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { displayLocale } from '@/lib/formatting';
import { cn } from '@/lib/utils';
import {
  filterCatalog,
  groupCatalog,
  moduleLabel,
  parsePermission,
  permissionLabel,
  type CatalogLabels,
  type RoleRecord,
} from '@/modules/roles/catalog';
import {
  canGrantKey,
  type CloneSeed,
  diffSelection,
  groupState,
  initialSelection,
  isDirty,
  roleIssue,
  rolePayload,
  setKeys,
  toggleKey,
  visibleKeys,
} from '@/modules/roles/editor';
import { riskCounts, riskOf, sensitiveKeys } from '@/modules/roles/risk';

/** مربع تحديد ثلاثي الحالة للمجموعة: `indeterminate` حقيقية + `aria-checked="mixed"`. */
function GroupCheckbox({
  state,
  label,
  disabled,
  onChange,
}: {
  state: 'none' | 'some' | 'all';
  label: string;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="accent-primary"
      aria-label={label}
      aria-checked={state === 'some' ? 'mixed' : state === 'all'}
      checked={state === 'all'}
      disabled={disabled}
      onChange={() => onChange(state !== 'all')}
    />
  );
}

/**
 * محرّر الدور (AC-UX-03B): لوحة جانبية بدل نافذة صغيرة لأن فيها كتالوجاً بـ134 صلاحية.
 *
 * - **الواجهة ليست حدّاً أمنياً**: الخادم يفرض سقف المنح وحماية المالك؛ هنا نُعطّل ما يُعرف سلفاً
 *   أنه سيُرفض (صلاحية خارج صلاحيات الفاعل) ونُظهر رسالة الخادم كما هي عند الرفض.
 * - المفتاح الكنسي يُخزَّن ويُرسَل حرفياً من الكتالوج؛ التسميات والحساسية عرضٌ فقط.
 * - تأثير الحفظ فوريّ على كل حاملي الدور (الدور يُقرأ حيّاً): يُقال ذلك صراحةً بعدد المستخدمين.
 */
export function RoleEditorSheet({
  open,
  onClose,
  onSaved,
  role,
  catalog,
  labels,
  actorPermissions,
  seed,
  sourceName,
}: {
  open: boolean;
  onClose: () => void;
  /** يُمرَّر المعرّف المحفوظ (إن أعاده الخادم) لتحديد الدور بعد إعادة التحميل. */
  onSaved: (savedId?: string) => void;
  /** دورٌ قائم = تعديل (PUT)؛ غيابه = إنشاء (POST). */
  role: RoleRecord | null;
  catalog: string[];
  labels: CatalogLabels;
  /** صلاحيات المشاهد الفعلية (مرآة سقف المنح). */
  actorPermissions: string[];
  /** نسخٌ لدور: يبدأ الإنشاء باسمٍ وصلاحياتٍ مبذورة (يُحسب «تغييراً» فيحميه حارس التجاهل). */
  seed?: CloneSeed;
  /** اسم الدور المنسوخ للإشعار. */
  sourceName?: string;
}) {
  const t = useTranslations('roleEditor');
  const tc = useTranslations('common');
  const locale = displayLocale(useLocale());
  const { success } = useToast();
  const num = (n: number) => n.toLocaleString(locale);

  const readOnly = role?.is_owner ?? false;
  const wildcard = role?.permissions.includes('*') ?? false;
  const initial = useMemo(() => initialSelection(role, catalog), [role, catalog]);
  const initialName = role?.name ?? '';

  const [name, setName] = useState(seed?.name ?? initialName);
  const [selected, setSelected] = useState<Set<string>>(() => (seed ? new Set(seed.permissions) : initial));
  const [query, setQuery] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  const groups = useMemo(() => groupCatalog(catalog), [catalog]);
  const visible = useMemo(
    () => filterCatalog(groups, { query, grantedOnly: selectedOnly }, selected, labels),
    [groups, query, selectedOnly, selected, labels],
  );
  const grantable = (key: string) => canGrantKey(actorPermissions, key);

  const dirty = isDirty(initialName, initial, name, selected);
  const issue = roleIssue(name, selected);
  const diff = useMemo(() => diffSelection(initial, selected, catalog), [initial, selected, catalog]);
  const addedSensitive = sensitiveKeys(diff.added);
  const sensitiveSelected = sensitiveKeys(selected);
  const counts = riskCounts(selected);

  const submitBlocked = saving || readOnly || !dirty || issue !== null;

  const requestClose = () => {
    if (saving) return;
    if (dirty && !readOnly) setConfirmingDiscard(true);
    else onClose();
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitBlocked) return;
    setSaving(true);
    setError(null);
    const body = rolePayload(name, selected, catalog);
    try {
      if (role) {
        await api(`/roles/${role.id}`, { method: 'PUT', body });
        success(tc('updated'));
        onSaved(role.id);
      } else {
        const created = await api<{ data?: { id?: string } }>('/roles', { method: 'POST', body });
        success(tc('created'));
        onSaved(created?.data?.id);
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const riskLabel = (key: string) => {
    const kind = riskOf(key);
    return kind ? t(`risk_${kind}`) : null;
  };

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) requestClose(); }}>
      <SheetContent closeLabel={t('close')} className="sm:max-w-2xl">
        <header className="shrink-0 border-b border-border px-5 pb-3 pe-14 pt-4">
          <SheetTitle className="text-base font-semibold text-text">
            {role ? `${t('title_edit')} — ${role.name}` : seed ? t('title_clone') : t('title_new')}
          </SheetTitle>
          <SheetDescription className="mt-1 text-xs leading-relaxed text-muted">
            {role ? t('description_edit') : seed ? t('description_clone') : t('description_new')}
          </SheetDescription>
        </header>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {seed ? (
              <p role="note" className="rounded border border-border bg-background px-3 py-2 text-xs text-text">
                {t('cloned_from', { name: sourceName ?? '' })}
                {seed.skipped > 0 ? ` ${t('clone_skipped', { n: seed.skipped, count: num(seed.skipped) })}` : ''}
              </p>
            ) : null}
            {readOnly ? <p className="rounded bg-primary-soft px-3 py-2 text-xs text-primary">{t('owner_note')}</p> : null}
            {!readOnly && role?.is_system ? (
              <p className="rounded border border-border px-3 py-2 text-xs text-muted">{t('system_note')}</p>
            ) : null}
            {!readOnly && wildcard ? (
              <p className="rounded bg-warning/10 px-3 py-2 text-xs text-warning">{t('wildcard_note')}</p>
            ) : null}
            {role && role.users_count > 0 ? (
              <p role="note" className="rounded border border-border bg-background px-3 py-2 text-xs text-text">
                {t('applies_to_users', { n: role.users_count, count: num(role.users_count) })}
              </p>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="role_name">{t('name')}</Label>
              <Input id="role_name" value={name} onChange={(e) => setName(e.target.value)} required disabled={readOnly} />
            </div>

            <section aria-labelledby="re-perms" className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <h3 id="re-perms" className="text-sm font-semibold text-text">{t('section_permissions')}</h3>
                <div className="relative min-w-[10rem] flex-1">
                  <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" strokeWidth={1.7} aria-hidden="true" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('search')}
                    aria-label={t('search')}
                    className="h-8 ps-8 text-xs"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-muted" htmlFor="re-selected-only">
                  <Switch id="re-selected-only" checked={selectedOnly} onCheckedChange={setSelectedOnly} aria-label={t('selected_only')} />
                  {t('selected_only')}
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <span aria-live="polite" className="num">
                  {t('selection_count', { selected: num(selected.size), total: num(catalog.length) })}
                </span>
                <span aria-live="polite" className="flex items-center gap-1">
                  {sensitiveSelected.length > 0 ? (
                    <>
                      <ShieldAlert className="h-3.5 w-3.5 text-warning" strokeWidth={1.8} aria-hidden="true" />
                      <span className="text-text">{t('sensitive_summary', { n: sensitiveSelected.length, count: num(sensitiveSelected.length) })}</span>
                    </>
                  ) : (
                    t('no_sensitive')
                  )}
                </span>
                {!readOnly ? (
                  <span className="ms-auto flex gap-1">
                    <button
                      type="button"
                      className="rounded px-2 py-1 text-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      onClick={() => setSelected((s) => setKeys(s, visibleKeys(visible), true, grantable))}
                      disabled={visible.length === 0}
                    >
                      {t('select_visible')}
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-1 hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      onClick={() => setSelected((s) => setKeys(s, visibleKeys(visible), false))}
                      disabled={visible.length === 0}
                    >
                      {t('clear_visible')}
                    </button>
                  </span>
                ) : null}
              </div>
              {sensitiveSelected.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5" aria-label={t('risk_label')}>
                  {(Object.entries(counts) as [keyof typeof counts, number][])
                    .filter(([, n]) => n > 0)
                    .map(([kind, n]) => (
                      <li key={kind}>
                        <Badge tone="warning">{t(`risk_${kind}`)} · <span className="num">{num(n)}</span></Badge>
                      </li>
                    ))}
                </ul>
              ) : null}

              {visible.length === 0 ? (
                <p className="rounded border border-border px-3 py-6 text-center text-sm text-muted">{t('no_match')}</p>
              ) : (
                <div className="space-y-4">
                  {visible.map((group) => {
                    const all = groups.find((g) => g.module === group.module)?.entries.map((e) => e.key) ?? [];
                    const state = groupState(selected, all);
                    const label = moduleLabel(group.module, labels);
                    const anyGrantable = all.some(grantable);
                    return (
                      <section key={group.module} aria-label={label}>
                        <h4 className="mb-1 flex items-center gap-2 border-b border-border pb-1 text-sm font-medium text-text">
                          {!readOnly ? (
                            <GroupCheckbox
                              state={state}
                              label={t('group_toggle', { module: label })}
                              disabled={!anyGrantable}
                              onChange={(on) => setSelected((s) => setKeys(s, all, on, on ? grantable : undefined))}
                            />
                          ) : null}
                          <span className="min-w-0 flex-1 truncate">{label}</span>
                          <span className="num text-xs font-normal text-muted">
                            {t('group_count', { selected: num(all.filter((k) => selected.has(k)).length), total: num(all.length) })}
                          </span>
                        </h4>
                        <ul>
                          {group.entries.map((entry) => {
                            const checked = selected.has(entry.key);
                            const risk = riskLabel(entry.key);
                            const canGrant = grantable(entry.key) || checked;
                            const describedBy = `${entry.key}-desc`;
                            const labelledBy = `${entry.key}-label`;
                            return (
                              <li key={entry.key}>
                                <label
                                  className={cn(
                                    'flex items-center gap-3 rounded px-1.5 py-1.5 text-sm hover:bg-background',
                                    (readOnly || !canGrant) && 'cursor-not-allowed opacity-70',
                                  )}
                                >
                                  <input
                                    type="checkbox"
                                    className="accent-primary"
                                    checked={checked}
                                    disabled={readOnly || (!canGrant)}
                                    aria-labelledby={labelledBy}
                                    aria-describedby={describedBy}
                                    onChange={() => setSelected((s) => toggleKey(s, entry.key))}
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span id={labelledBy} className="block text-text">{permissionLabel(entry, labels)}</span>
                                    <span id={describedBy} className="block text-xs text-muted">
                                      <span className="num" dir="ltr">{entry.key}</span>
                                      {!canGrant ? ` · ${t('not_grantable')}` : ''}
                                    </span>
                                  </span>
                                  {risk ? (
                                    <Badge tone="warning" wrap>
                                      <ShieldAlert className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
                                      {risk}
                                    </Badge>
                                  ) : null}
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <footer className="shrink-0 border-t border-border bg-surface px-5 py-3">
            {error ? <p role="alert" className="mb-2 rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p> : null}
            {confirmingDiscard ? (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-text">{t('discard_title')}</p>
                  <p className="text-xs text-muted">{t('discard_body')}</p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" autoFocus onClick={() => setConfirmingDiscard(false)}>{t('keep_editing')}</Button>
                  <Button type="button" variant="danger" onClick={onClose}>{t('discard')}</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {dirty && issue ? <p className="text-xs text-negative">{t(issue)}</p> : null}
                {dirty && role && (diff.added.length > 0 || diff.removed.length > 0) ? (
                  <p className="text-xs text-muted" aria-live="polite">
                    <span className="num">{t('diff_summary', { added: num(diff.added.length), removed: num(diff.removed.length) })}</span>
                    {addedSensitive.length > 0 ? (
                      <span className="mt-0.5 block text-text">
                        {t('diff_sensitive_added', { list: addedSensitive.map((key) => permissionLabelByKey(key, labels)).join(' · ') })}
                      </span>
                    ) : null}
                  </p>
                ) : null}
                <div className="flex items-center justify-end gap-2">
                  {!dirty && !readOnly ? <span className="me-auto text-xs text-muted">{t('no_changes')}</span> : null}
                  <Button type="button" variant="outline" onClick={requestClose}>{t('cancel')}</Button>
                  {!readOnly ? <Button type="submit" disabled={submitBlocked}>{saving ? t('saving') : t('save')}</Button> : null}
                </div>
              </div>
            )}
          </footer>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** تسمية صلاحية بمفتاحها للملخّص (وحدة: مجال — فعل). عرضٌ فقط. */
function permissionLabelByKey(key: string, labels: CatalogLabels): string {
  const entry = parsePermission(key);
  return `${moduleLabel(entry.module, labels)}: ${permissionLabel(entry, labels)}`;
}

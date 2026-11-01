'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  NAV_LIMITS, NAV_TAB_ICONS, addNavTab, moveNavTab, removeNavTab, setAppBar, updateNavTab, visibleTabCount,
  type AppSchema, type AppSchemaAppBar, type NavTabIcon,
} from '@/lib/app-builder';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * غلاف التطبيق (AD-04 / S09d) في الوضع السهل: التبويبات السفلية والشريط العلوي. يعدّل `navigation.tabs`/`navigation.appBar`
 * عبر دوال المخطط النقية (تحدّ ظاهرة ≤ 5، عنوان ≤ 24، أيقونات من قائمة مغلقة، تبويب واحد لكل صفحة)؛ والتحقق النهائي
 * عند النشر (الفاحصة + المحلل). يتطلب إصدار التطبيق 1.1.0+ — يظهر في تقرير التوافق لا هنا فقط.
 */
export function EasyShellPanel({
  schema, pageLabel, canManage, onEdit, t,
}: {
  schema: AppSchema;
  /** اسم الصفحة المعروض (عنوان مخصّص أو المعرّف). */
  pageLabel: (pageId: string) => string;
  canManage: boolean;
  /** يطبّق تعديلاً على المخطط؛ المحوّل يعيد `null` لرفض التعديل (حد مخالف) فلا يتغير شيء. */
  onEdit: (edit: (current: AppSchema) => AppSchema | null) => void;
  t: Translate;
}) {
  const tabs = schema.navigation.tabs ?? [];
  const appBar = schema.navigation.appBar;
  const pageIds = Object.keys(schema.pages);
  const available = pageIds.filter((id) => !tabs.some((tab) => tab.pageId === id));
  const visible = visibleTabCount(schema);
  const limitReached = visible >= NAV_LIMITS.maxVisibleTabs;
  const [toAdd, setToAdd] = React.useState('');
  const addTarget = available.includes(toAdd) ? toAdd : (available[0] ?? '');

  const setBar = (patch: Partial<AppSchemaAppBar>) =>
    onEdit((current) => setAppBar(current, { ...current.navigation.appBar, ...patch }));

  return (
    <div className="space-y-5 p-3" data-testid="easy-shell">
      <p className="rounded-md bg-primary-soft px-2 py-1.5 text-[11px] leading-relaxed text-primary">{t('easy.shell.versionNote')}</p>

      <section className="space-y-2" aria-labelledby="easy-shell-tabs-title">
        <div className="flex items-center justify-between">
          <h2 id="easy-shell-tabs-title" className="text-xs font-semibold text-text">{t('easy.shell.tabsTitle')}</h2>
          {tabs.length > 0 ? <Badge tone="muted">{t('easy.shell.visibleCount', { n: visible, max: NAV_LIMITS.maxVisibleTabs })}</Badge> : null}
        </div>
        <p className="text-[11px] leading-relaxed text-muted">{t('easy.shell.tabsHint')}</p>

        {tabs.length === 0 ? (
          <Button
            type="button"
            size="sm"
            disabled={!canManage}
            onClick={() => onEdit((current) => addNavTab(current, current.navigation.initialPageId, pageLabel(current.navigation.initialPageId)))}
          >
            {t('easy.shell.enableTabs')}
          </Button>
        ) : (
          <ul className="space-y-2">
            {tabs.map((tab, index) => {
              const label = pageLabel(tab.pageId);
              const hidden = tab.hidden === true;
              return (
                <li key={tab.pageId} className="space-y-1.5 rounded-md border border-border p-2" data-testid={`shell-tab-${tab.pageId}`}>
                  <div className="flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-text">{label}</span>
                    <button
                      type="button"
                      disabled={!canManage || index === 0}
                      aria-label={t('easy.shell.tabUp', { page: label })}
                      onClick={() => onEdit((current) => moveNavTab(current, tab.pageId, 'up'))}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-primary-soft disabled:opacity-30"
                    >
                      <ArrowUp className="h-3 w-3" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={!canManage || index === tabs.length - 1}
                      aria-label={t('easy.shell.tabDown', { page: label })}
                      onClick={() => onEdit((current) => moveNavTab(current, tab.pageId, 'down'))}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-primary-soft disabled:opacity-30"
                    >
                      <ArrowDown className="h-3 w-3" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={!canManage}
                      aria-label={t('easy.shell.tabRemove', { page: label })}
                      onClick={() => onEdit((current) => removeNavTab(current, tab.pageId))}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-primary-soft hover:text-primary disabled:opacity-30"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                  <Input
                    aria-label={t('easy.shell.tabTitle', { page: label })}
                    value={tab.title}
                    maxLength={NAV_LIMITS.maxTabTitle}
                    disabled={!canManage}
                    className="h-8 text-xs"
                    aria-invalid={tab.title.trim() === '' ? true : undefined}
                    onChange={(e) => onEdit((current) => updateNavTab(current, tab.pageId, { title: e.target.value }))}
                  />
                  {tab.title.trim() === '' ? <p className="text-[11px] text-negative" role="alert">{t('easy.shell.tabTitleRequired')}</p> : null}
                  <div className="flex items-center gap-2">
                    <Select
                      aria-label={t('easy.shell.tabIcon', { page: label })}
                      value={tab.icon}
                      disabled={!canManage}
                      className="h-8 flex-1 text-xs"
                      onChange={(e) => onEdit((current) => updateNavTab(current, tab.pageId, { icon: e.target.value as NavTabIcon }))}
                    >
                      {NAV_TAB_ICONS.map((icon) => (
                        <option key={icon} value={icon}>{t(`easy.shell.icons.${icon}`)}</option>
                      ))}
                    </Select>
                    <label className="flex shrink-0 items-center gap-1.5 text-xs text-text">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={hidden}
                        disabled={!canManage || (hidden && limitReached)}
                        onChange={(e) => onEdit((current) => updateNavTab(current, tab.pageId, { hidden: e.target.checked }))}
                      />
                      {t('easy.shell.tabHidden')}
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {tabs.length > 0 ? (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Select
                aria-label={t('easy.shell.addTabPage')}
                value={addTarget}
                disabled={!canManage || available.length === 0 || limitReached}
                className="h-8 flex-1 text-xs"
                onChange={(e) => setToAdd(e.target.value)}
              >
                {available.map((id) => (
                  <option key={id} value={id}>{pageLabel(id)}</option>
                ))}
              </Select>
              <Button
                type="button"
                size="sm"
                className="h-8 shrink-0 text-xs"
                disabled={!canManage || !addTarget || limitReached}
                onClick={() => onEdit((current) => addNavTab(current, addTarget, pageLabel(addTarget)))}
              >
                {t('easy.shell.addTab')}
              </Button>
            </div>
            {limitReached ? <p className="text-[11px] text-muted">{t('easy.shell.limitReached', { max: NAV_LIMITS.maxVisibleTabs })}</p> : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-2" aria-labelledby="easy-shell-bar-title">
        <h2 id="easy-shell-bar-title" className="text-xs font-semibold text-text">{t('easy.shell.barTitle')}</h2>
        <label className="block text-xs font-medium text-text" htmlFor="easy-shell-bar-text">{t('easy.shell.barText')}</label>
        <Input
          id="easy-shell-bar-text"
          value={appBar?.title ?? ''}
          maxLength={NAV_LIMITS.maxAppBarTitle}
          disabled={!canManage}
          className="h-8 text-xs"
          placeholder={t('easy.shell.barTextPlaceholder')}
          onChange={(e) => setBar({ title: e.target.value })}
        />
        <label className="flex items-center gap-2 text-xs text-text">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={appBar?.showCart === true}
            disabled={!canManage}
            onChange={(e) => setBar({ showCart: e.target.checked })}
          />
          {t('easy.shell.showCart')}
        </label>
      </section>
    </div>
  );
}

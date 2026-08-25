'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Pencil, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { currentUser } from '@/lib/auth';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import type { ReportTableViewState } from '@/components/reports/report-data-table';

const STORAGE_VERSION = 1;
const MAX_VIEW_NAME_LENGTH = 60;

export interface SavedReportView {
  version: typeof STORAGE_VERSION;
  id: string;
  name: string;
  reportKey: string;
  state: ReportTableViewState;
  createdAt: string;
  updatedAt: string;
}

interface StoredSavedReportViews {
  version: typeof STORAGE_VERSION;
  reportKey: string;
  views: SavedReportView[];
}

interface SavedViewLabels {
  views: string;
  defaultView: string;
  saveCurrent: string;
  saveView: string;
  renameView: string;
  deleteView: string;
  deleteConfirmation: string;
  cancel: string;
  delete: string;
  viewName: string;
  viewNamePlaceholder: string;
  nameRequired: string;
  duplicateName: string;
  nameTooLong: string;
  modified: string;
  noSavedViews: string;
}

function savedViewLabels(locale: string): SavedViewLabels {
  if (locale.toLowerCase().startsWith('ar')) {
    return {
      views: 'طرق العرض',
      defaultView: 'الوضع الافتراضي',
      saveCurrent: 'حفظ العرض الحالي',
      saveView: 'حفظ العرض',
      renameView: 'إعادة تسمية العرض',
      deleteView: 'حذف العرض',
      deleteConfirmation: 'هل تريد حذف هذا العرض المحفوظ؟',
      cancel: 'إلغاء',
      delete: 'حذف',
      viewName: 'اسم العرض',
      viewNamePlaceholder: 'مثال: مراجعة نهاية الشهر',
      nameRequired: 'أدخل اسمًا للعرض.',
      duplicateName: 'يوجد عرض محفوظ بالاسم نفسه.',
      nameTooLong: 'يجب ألا يتجاوز الاسم 60 حرفًا.',
      modified: 'تم التعديل',
      noSavedViews: 'لا توجد عروض محفوظة بعد.',
    };
  }

  return {
    views: 'Views',
    defaultView: 'Default view',
    saveCurrent: 'Save current view',
    saveView: 'Save view',
    renameView: 'Rename view',
    deleteView: 'Delete view',
    deleteConfirmation: 'Delete this saved view?',
    cancel: 'Cancel',
    delete: 'Delete',
    viewName: 'View name',
    viewNamePlaceholder: 'Example: Month-end review',
    nameRequired: 'Enter a view name.',
    duplicateName: 'A saved view already uses this name.',
    nameTooLong: 'The name must be 60 characters or fewer.',
    modified: 'Modified',
    noSavedViews: 'No saved views yet.',
  };
}

function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `report-view-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function sameState(left: ReportTableViewState, right: ReportTableViewState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseColumnOrder(value: unknown): ReportTableViewState['columnOrder'] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) return null;
  return value;
}

function parseColumnSizing(value: unknown): ReportTableViewState['columnSizing'] | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const sizing: ReportTableViewState['columnSizing'] = {};
  for (const [id, size] of Object.entries(value)) {
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 80 || size > 640) return null;
    sizing[id] = size;
  }
  return sizing;
}

function parseState(value: unknown): ReportTableViewState | null {
  if (!isRecord(value)) return null;
  if (value.density !== 'compact' && value.density !== 'comfortable') return null;
  if (![10, 25, 50, 100].includes(value.pageSize as number)) return null;
  if (!isRecord(value.columnVisibility) || !Array.isArray(value.sorting)) return null;
  const columnOrder = parseColumnOrder(value.columnOrder);
  const columnSizing = parseColumnSizing(value.columnSizing);
  if (!columnOrder || !columnSizing) return null;

  const columnVisibility: Record<string, boolean> = {};
  for (const [key, visible] of Object.entries(value.columnVisibility)) {
    if (typeof visible !== 'boolean') return null;
    columnVisibility[key] = visible;
  }

  const sorting = value.sorting.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.desc !== 'boolean') return null;
    return { id: item.id, desc: item.desc };
  });
  if (sorting.some((item) => item === null)) return null;

  return { columnVisibility, sorting: sorting as ReportTableViewState['sorting'], density: value.density, pageSize: value.pageSize as number, columnOrder, columnSizing };
}

export function parseStoredSavedReportViews(value: string, reportKey: string): SavedReportView[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION || parsed.reportKey !== reportKey || !Array.isArray(parsed.views)) return null;

    const views = parsed.views.map((view) => {
      if (!isRecord(view) || view.version !== STORAGE_VERSION || view.reportKey !== reportKey) return null;
      const state = parseState(view.state);
      const name = typeof view.name === 'string' ? normalizeName(view.name) : '';
      if (!state || !name || name.length > MAX_VIEW_NAME_LENGTH || typeof view.id !== 'string' || typeof view.createdAt !== 'string' || typeof view.updatedAt !== 'string') return null;
      return { version: STORAGE_VERSION, id: view.id, name, reportKey, state, createdAt: view.createdAt, updatedAt: view.updatedAt } satisfies SavedReportView;
    });

    return views.some((view) => view === null) ? null : views as SavedReportView[];
  } catch {
    return null;
  }
}

function storageKey(reportKey: string): string {
  let user: ReturnType<typeof currentUser> = null;
  try {
    user = currentUser();
  } catch {
    // قد تكون جلسة التخزين نفسها محجوبة؛ المفتاح المجهول يحافظ على عمل التقرير بلا استثناء.
  }
  const tenantId = user?.tenant_id ?? 'anonymous';
  const userId = user?.id ?? 'anonymous';
  return `nibras_report_saved_views_v${STORAGE_VERSION}:${tenantId}:${userId}:${reportKey}`;
}

function cloneState(state: ReportTableViewState): ReportTableViewState {
  return {
    columnVisibility: { ...state.columnVisibility },
    sorting: state.sorting.map((sort) => ({ ...sort })),
    density: state.density,
    pageSize: state.pageSize,
    columnOrder: [...state.columnOrder],
    columnSizing: { ...state.columnSizing },
  };
}

export interface SavedReportViewsController {
  loaded: boolean;
  views: SavedReportView[];
  viewState: ReportTableViewState;
  selectedViewId: string | null;
  isModified: boolean;
  applyDefaultView: () => void;
  applyView: (id: string) => void;
  saveView: (name: string) => string | null;
  renameView: (id: string, name: string) => string | null;
  deleteView: (id: string) => void;
  setViewState: (state: ReportTableViewState) => void;
}

export function useSavedReportViews(reportKey: string | undefined, defaultState: ReportTableViewState): SavedReportViewsController {
  const defaultStateRef = useRef(cloneState(defaultState));
  const [loaded, setLoaded] = useState(false);
  const [views, setViews] = useState<SavedReportView[]>([]);
  const [viewState, setViewState] = useState<ReportTableViewState>(() => cloneState(defaultState));
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    defaultStateRef.current = cloneState(defaultState);
  }, [defaultState]);

  useEffect(() => {
    setLoaded(false);
    setViews([]);
    setSelectedViewId(null);
    setViewState(cloneState(defaultStateRef.current));
    keyRef.current = null;
    if (!reportKey || typeof window === 'undefined') {
      setLoaded(true);
      return;
    }

    const key = storageKey(reportKey);
    keyRef.current = key;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      // بعض بيئات المتصفح تمنع القراءة من التخزين المحلي؛ نعود إلى العرض الافتراضي بصمت.
    }
    const stored = raw ? parseStoredSavedReportViews(raw, reportKey) : null;
    setViews(stored ?? []);
    setLoaded(true);
  }, [reportKey]);

  const persist = useCallback((nextViews: SavedReportView[]) => {
    if (!reportKey || !keyRef.current) return;
    const payload: StoredSavedReportViews = { version: STORAGE_VERSION, reportKey, views: nextViews };
    try {
      localStorage.setItem(keyRef.current, JSON.stringify(payload));
    } catch {
      // الاستمرارية المحلية تحسين واجهة فقط؛ فشلها لا يمنع قراءة التقرير أو تغييره.
    }
  }, [reportKey]);

  const saveView = useCallback((rawName: string): string | null => {
    if (!reportKey) return null;
    const name = normalizeName(rawName);
    if (!name) return 'required';
    if (name.length > MAX_VIEW_NAME_LENGTH) return 'tooLong';
    if (views.some((view) => view.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)) return 'duplicate';

    const now = new Date().toISOString();
    const view: SavedReportView = { version: STORAGE_VERSION, id: newId(), name, reportKey, state: cloneState(viewState), createdAt: now, updatedAt: now };
    const nextViews = [...views, view];
    setViews(nextViews);
    setSelectedViewId(view.id);
    persist(nextViews);
    return null;
  }, [persist, reportKey, viewState, views]);

  const renameView = useCallback((id: string, rawName: string): string | null => {
    const name = normalizeName(rawName);
    if (!name) return 'required';
    if (name.length > MAX_VIEW_NAME_LENGTH) return 'tooLong';
    if (views.some((view) => view.id !== id && view.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)) return 'duplicate';

    const nextViews = views.map((view) => view.id === id ? { ...view, name, updatedAt: new Date().toISOString() } : view);
    setViews(nextViews);
    persist(nextViews);
    return null;
  }, [persist, views]);

  const applyDefaultView = useCallback(() => {
    setViewState(cloneState(defaultStateRef.current));
    setSelectedViewId(null);
  }, []);

  const applyView = useCallback((id: string) => {
    const view = views.find((item) => item.id === id);
    if (!view) return;
    setViewState(cloneState(view.state));
    setSelectedViewId(view.id);
  }, [views]);

  const deleteView = useCallback((id: string) => {
    const nextViews = views.filter((view) => view.id !== id);
    setViews(nextViews);
    if (selectedViewId === id) setSelectedViewId(null);
    persist(nextViews);
  }, [persist, selectedViewId, views]);

  const selected = views.find((view) => view.id === selectedViewId);
  const isModified = !!selected && !sameState(selected.state, viewState);

  return { loaded, views, viewState, selectedViewId, isModified, applyDefaultView, applyView, saveView, renameView, deleteView, setViewState };
}

export function ReportSavedViewsMenu({ controller, locale, className }: { controller: SavedReportViewsController; locale: string; className?: string }) {
  const labels = savedViewLabels(locale);
  const [mode, setMode] = useState<'save' | 'rename' | 'delete' | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [validation, setValidation] = useState<string | null>(null);
  const target = controller.views.find((view) => view.id === targetId) ?? null;

  function closeDialog() {
    setMode(null);
    setTargetId(null);
    setName('');
    setValidation(null);
  }

  function openSave() {
    setName('');
    setValidation(null);
    setMode('save');
  }

  function openRename(view: SavedReportView) {
    setTargetId(view.id);
    setName(view.name);
    setValidation(null);
    setMode('rename');
  }

  function openDelete(view: SavedReportView) {
    setTargetId(view.id);
    setMode('delete');
  }

  function saveName() {
    const error = mode === 'rename' && target ? controller.renameView(target.id, name) : controller.saveView(name);
    if (error) {
      setValidation(error);
      return;
    }
    closeDialog();
  }

  const validationText = validation === 'required' ? labels.nameRequired
    : validation === 'duplicate' ? labels.duplicateName
      : validation === 'tooLong' ? labels.nameTooLong
        : null;

  return (
    <div className={className}>
      <Dropdown
        trigger={<><Bookmark className="h-4 w-4" strokeWidth={1.7} /><span>{labels.views}</span></>}
        menuLabel={labels.views}
        triggerLabel={labels.views}
        triggerClassName="h-9 gap-2 border border-border bg-surface px-3 text-sm font-medium text-text hover:bg-primary-soft"
        menuClassName="min-w-64 p-2"
      >
        <DropdownItem icon={RotateCcw} onClick={controller.applyDefaultView}>{labels.defaultView}</DropdownItem>
        {controller.isModified && <p className="px-2 py-1 text-xs text-muted">{labels.modified}</p>}
        <div className="my-1 border-t border-border" />
        {controller.views.length === 0 ? <p className="px-2 py-2 text-xs text-muted">{labels.noSavedViews}</p> : controller.views.map((view) => (
          <div key={view.id} className="rounded">
            <DropdownItem onClick={() => controller.applyView(view.id)}>{view.name}</DropdownItem>
            <DropdownItem icon={Pencil} onClick={() => openRename(view)}>{`${labels.renameView}: ${view.name}`}</DropdownItem>
            <DropdownItem icon={Trash2} tone="danger" onClick={() => openDelete(view)}>{`${labels.deleteView}: ${view.name}`}</DropdownItem>
          </div>
        ))}
        <div className="my-1 border-t border-border" />
        <DropdownItem icon={Plus} onClick={openSave}>{labels.saveCurrent}</DropdownItem>
      </Dropdown>

      <Dialog open={mode !== null} onClose={closeDialog} title={mode === 'rename' ? labels.renameView : mode === 'delete' ? labels.deleteView : labels.saveView}>
        {mode === 'delete' ? (
          <div className="space-y-4">
            <p className="text-sm text-text">{labels.deleteConfirmation}</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={closeDialog}>{labels.cancel}</Button>
              <Button variant="outline" size="sm" onClick={() => { if (target) controller.deleteView(target.id); closeDialog(); }}>
                <Trash2 className="h-4 w-4" strokeWidth={1.7} />{labels.delete}
              </Button>
            </div>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); saveName(); }}>
            <label className="block space-y-1.5 text-sm font-medium text-text">
              <span>{labels.viewName}</span>
              <Input autoFocus value={name} maxLength={MAX_VIEW_NAME_LENGTH} placeholder={labels.viewNamePlaceholder} onChange={(event) => { setName(event.target.value); setValidation(null); }} aria-invalid={!!validation} aria-describedby={validation ? 'saved-view-name-error' : undefined} />
            </label>
            {validationText && <p id="saved-view-name-error" className="text-sm text-negative">{validationText}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={closeDialog}>{labels.cancel}</Button>
              <Button type="submit" size="sm"><Save className="h-4 w-4" strokeWidth={1.7} />{mode === 'rename' ? labels.renameView : labels.saveView}</Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}

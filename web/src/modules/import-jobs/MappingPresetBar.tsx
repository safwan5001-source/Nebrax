'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BookmarkPlus, Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import type { ImportJobDomain } from './client';
import {
  deleteMappingPreset,
  hasMappedField,
  listMappingPresets,
  matchMappingPreset,
  mergePresetMapping,
  presetColumnsFromMapping,
  saveMappingPreset,
  type ColumnMapping,
  type MappingPreset,
} from './mapping-presets';

interface Props {
  domain: ImportJobDomain;
  /** أعمدة الملف المفحوص (فهرس + عنوان). */
  columns: { index: number; header: string }[];
  /** المطابقة الحالية في المعالج. */
  mapping: ColumnMapping;
  /** مفاتيح حقول المجال المعروفة في هذا الملف (عقد الفحص) — ما عداها يُسقَط عند التطبيق. */
  fieldKeys: string[];
  /** يُستدعى بالمطابقة الجديدة بعد التطبيق؛ يُسقط المعالجُ المعاينةَ كأي تغيير يدوي للمطابقة. */
  onApply: (next: ColumnMapping) => void;
}

/**
 * شريط المطابقات المحفوظة داخل بطاقة مطابقة الأعمدة (IMP-H8-S2b): تطبيق مطابقةٍ محفوظة على الملف الحالي (بعنوان العمود لا بموضعه)، وحفظ المطابقة الحالية باسم، وحذف. **لا يغيّر
 * سياسات التشغيل** (لا تُحفظ مع المطابقة) ولا يكتب شيئاً عدا إعداد المطابقة نفسه. فشل جلب القائمة أو منعٌ بالصلاحية (403) يُخفي الشريط بصمت: ميزةٌ مساعدة لا تعطّل الاستيراد.
 */
export function MappingPresetBar({ domain, columns, mapping, fieldKeys, onApply }: Props) {
  const t = useTranslations('mappingPresets');
  const [presets, setPresets] = useState<MappingPreset[] | null>(null);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const allowed = useMemo(() => new Set(fieldKeys), [fieldKeys]);

  useEffect(() => {
    let cancelled = false;
    listMappingPresets(domain)
      .then((list) => {
        if (!cancelled) setPresets(list);
      })
      .catch(() => {
        // فشل الجلب (شبكة/صلاحية): تبقى القائمة `null` فيُخفى الشريط، لا خطأ يُعرض.
      });
    return () => {
      cancelled = true;
    };
  }, [domain]);

  if (presets === null) return null;

  const current = presets.find((preset) => preset.id === selected) ?? null;
  const fail = (err: unknown) => setError(err instanceof ApiError ? err.message : t('failed'));

  async function apply() {
    if (!current) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const match = await matchMappingPreset(current.id, columns.map((column) => column.header ?? ''));
      const merged = mergePresetMapping(mapping, match, allowed);
      onApply(merged.mapping);
      setNote(t('applied', { applied: merged.applied, unmatched: match.unmatched.length }) + (merged.dropped > 0 ? ` ${t('dropped', { count: merged.dropped })}` : ''));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const saved = await saveMappingPreset(domain, name.trim(), presetColumnsFromMapping(columns, mapping));
      setPresets((list) => [...(list ?? []), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setSelected(saved.id);
      setName('');
      setNote(t('saved', { name: saved.name }));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!current) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await deleteMappingPreset(current.id);
      setPresets((list) => (list ?? []).filter((preset) => preset.id !== current.id));
      setSelected('');
      setConfirmDelete(false);
      setNote(t('deleted', { name: current.name }));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-background px-3 py-3" role="group" aria-label={t('title')}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1 space-y-1">
          <Label htmlFor="mp-select">{t('title')}</Label>
          <Select id="mp-select" value={selected} onChange={(event) => { setSelected(event.target.value); setConfirmDelete(false); setNote(null); }}>
            <option value="">{presets.length === 0 ? t('none_saved') : t('choose')}</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </Select>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={!current || busy} onClick={() => void apply()}>
          <Check className="h-4 w-4" strokeWidth={1.7} />
          {t('apply')}
        </Button>
        {confirmDelete ? (
          <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => void remove()}>
            <Trash2 className="h-4 w-4" strokeWidth={1.7} />
            {t('confirm_delete')}
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="sm" disabled={!current || busy} onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4" strokeWidth={1.7} />
            {t('delete')}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1 space-y-1">
          <Label htmlFor="mp-name">{t('save_as')}</Label>
          <Input id="mp-name" maxLength={80} value={name} placeholder={t('name_placeholder')} onChange={(event) => setName(event.target.value)} />
        </div>
        <Button type="button" variant="outline" size="sm" disabled={busy || name.trim() === '' || !hasMappedField(mapping)} onClick={() => void save()}>
          <BookmarkPlus className="h-4 w-4" strokeWidth={1.7} />
          {t('save')}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted">{t('note')}</p>
      {note ? <p role="status" className="text-xs leading-relaxed text-text">{note}</p> : null}
      {error ? <p role="alert" className="text-xs leading-relaxed text-negative">{error}</p> : null}
    </div>
  );
}

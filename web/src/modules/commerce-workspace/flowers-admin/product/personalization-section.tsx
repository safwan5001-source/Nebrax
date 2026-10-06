'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { EmptyState, FormActions, FormAlert } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import type { AdminFailure } from '../admin-http';
import { ConfirmDialog } from '../confirm-dialog';
import { failureText } from '../failure-text';
import { flowersAdminT } from '../messages';
import { useUnsavedGuard } from '../use-unsaved-guard';
import { PersonalizationFieldDialog } from './personalization-field-dialog';
import {
  MAX_FIELDS,
  canAddField,
  loadPersonalization,
  move,
  newField,
  savePersonalization,
  signature,
  validateField,
  type PersonalizationField,
} from './personalization';
import { SectionState } from './section-state';

type Phase = { kind: 'loading' } | { kind: 'failed'; failure: AdminFailure } | { kind: 'ready'; saved: PersonalizationField[]; revision: string | null };
type DialogState = { kind: 'add'; field: PersonalizationField } | { kind: 'edit'; index: number } | null;

/**
 * FLOWERS-H2-7 / ADR-16 — تخصيص المنتج: قائمة مُدخَلات مدمجة قابلة للترتيب + محرِّر مركَّز لكل مُدخَل. التعديلات
 * تُجمَّع محلياً وتُحفظ دفعة واحدة (الخادم يستبدل المجموعة كاملةً بالمفتاح)، وقبل الحفظ نتأكد أن ما على الخادم لم
 * يتغيّر منذ عرضناه. لا أثر سعري ولا رفع ملفات ولا HTML: نصٌّ عادي فقط.
 */
export function PersonalizationSection({ productId, locale, canManage }: { productId: string; locale: string | undefined; canManage: boolean }) {
  const t = useMemo(() => flowersAdminT(locale), [locale]);
  const { success: toastSuccess } = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<PersonalizationField[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'warning'; text: string } | null>(null);

  useEffect(() => {
    let current = true;
    setPhase({ kind: 'loading' });
    void loadPersonalization(productId).then((result) => {
      if (!current) return;
      if (!result.ok) {
        setPhase({ kind: 'failed', failure: result });
        return;
      }
      setDraft(result.data.fields);
      setPhase({ kind: 'ready', saved: result.data.fields, revision: result.data.revision });
    });
    return () => {
      current = false;
    };
  }, [productId, attempt]);

  const saved = phase.kind === 'ready' ? phase.saved : [];
  const dirty = phase.kind === 'ready' && signature(draft) !== signature(saved);
  useUnsavedGuard(dirty);

  if (phase.kind !== 'ready') return <SectionState phase={phase} t={t} onRetry={() => setAttempt((n) => n + 1)} />;

  const invalidCount = draft.filter((field, index) => validateField(field, draft.filter((_, i) => i !== index)).length > 0).length;
  const editing = dialog?.kind === 'edit' ? draft[dialog.index] : null;

  async function onSave() {
    if (saving || !dirty || !canManage) return;
    if (invalidCount > 0) {
      setNotice({ tone: 'error', text: t('persFixInvalid') });
      return;
    }
    setSaving(true);
    setNotice(null);
    // الاستبدال كامل ⇒ التحقق من «لم يتغيّر شيء» داخل قفل الخادم (`expected_revision` ⇒ 409). الفحص المسبق احتياطٌ لخادمٍ بلا
    // بصمة، وفشل قراءته يُوقف الحفظ بدل أن يكتب من نسخة قد تكون قديمة.
    let revision = phase.kind === 'ready' ? phase.revision : null;
    if (revision === null) {
      const fresh = await loadPersonalization(productId);
      if (!fresh.ok) {
        setSaving(false);
        setNotice({ tone: 'error', text: failureText(fresh, t) });
        return;
      }
      if (signature(fresh.data.fields) !== signature(saved)) {
        setSaving(false);
        setDraft(fresh.data.fields);
        setPhase({ kind: 'ready', saved: fresh.data.fields, revision: fresh.data.revision });
        setNotice({ tone: 'warning', text: t('persStale') });
        return;
      }
      // الفحص المسبق قد يعيد بصمة (نشرٌ تدريجي للخادم): نحملها إلى الـPUT فيرفض الخادم أي تعديل متزامن بعد القراءة.
      revision = fresh.data.revision;
    }
    const result = await savePersonalization(productId, draft, revision);
    if (!result.ok && result.kind === 'conflict') {
      const fresh = await loadPersonalization(productId);
      setSaving(false);
      if (!fresh.ok) {
        // لم نستطع التحديث: لا ندّعي ذلك، ونُسقط البصمة القديمة كي لا يتكرر التعارض نفسه؛ الحفظ التالي يمرّ بالفحص المسبق (يفشل مغلقاً).
        setPhase({ kind: 'ready', saved, revision: null });
        setNotice({ tone: 'error', text: failureText(fresh, t) });
        return;
      }
      setDraft(fresh.data.fields);
      setPhase({ kind: 'ready', saved: fresh.data.fields, revision: fresh.data.revision });
      setNotice({ tone: 'warning', text: t('persStale') });
      return;
    }
    setSaving(false);
    if (!result.ok) {
      setNotice({ tone: 'error', text: failureText(result, t) });
      return;
    }
    setDraft(result.data.fields);
    setPhase({ kind: 'ready', saved: result.data.fields, revision: result.data.revision });
    toastSuccess(t('persSaved'));
  }

  const typeLabel = (field: PersonalizationField) => (field.type === 'text' ? t('persTypeText') : field.type === 'textarea' ? t('persTypeTextarea') : t('persTypeSelect'));

  return (
    <section aria-labelledby="pers-title" className="max-w-3xl space-y-4" data-personalization-section>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl space-y-1">
          <h2 id="pers-title" className="text-sm font-semibold text-text">{t('persTitle')}</h2>
          <p className="text-xs leading-5 text-muted">{t('persIntro')}</p>
        </div>
        {canManage ? (
          <Button type="button" className="w-full sm:w-auto" disabled={!canAddField(draft) || saving} onClick={() => setDialog({ kind: 'add', field: newField(draft) })}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('persAdd')}
          </Button>
        ) : null}
      </div>
      {!canAddField(draft) ? <p className="text-xs text-muted">{t('persLimit', { max: MAX_FIELDS })}</p> : null}
      {!canManage ? <FormAlert tone="info">{t('readOnly')}</FormAlert> : null}

      {draft.length === 0 ? (
        <EmptyState
          title={t('persEmptyTitle')}
          description={t('persEmptyDescription')}
          action={
            canManage ? (
              <Button type="button" onClick={() => setDialog({ kind: 'add', field: newField(draft) })}>
                {t('persAdd')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-border rounded border border-border bg-surface" data-personalization-list>
          {draft.map((field, index) => {
            const invalid = validateField(field, draft.filter((_, i) => i !== index)).length > 0;
            return (
              <li key={`${field.key}-${index}`} className={cn('flex items-center justify-between gap-3 px-4 py-3 text-sm', !field.isActive && 'text-muted')} data-personalization-row={field.key}>
                <div className="min-w-0 space-y-0.5">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className={cn('font-medium', field.isActive ? 'text-text' : 'text-muted')}>{field.label || t('persUnnamed')}</span>
                    {field.isRequired ? <span className="text-xs text-muted">· {t('persRequiredShort')}</span> : null}
                    {!field.isActive ? <span className="text-xs">· {t('winStatusOff')}</span> : null}
                    {invalid ? <span className="text-xs text-negative">· {t('persNeedsFix')}</span> : null}
                    {!field.persisted ? <span className="text-xs text-muted">· {t('persNew')}</span> : null}
                  </p>
                  <p className="text-xs text-muted">
                    {typeLabel(field)}
                    {field.type === 'select' ? ` · ${t('persOptionsCount', { n: field.options.length })}` : field.maxLength ? ` · ${t('persMaxShort', { n: field.maxLength })}` : ''}
                    {' · '}
                    <bdi className="font-mono">{field.key}</bdi>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button type="button" variant="ghost" size="icon" aria-label={`${canManage ? t('winEdit') : t('persView')}: ${field.label}`} disabled={saving} onClick={() => setDialog({ kind: 'edit', index })}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  {canManage ? (
                    <>
                      <Button type="button" variant="ghost" size="icon" aria-label={`${t('winMoveUp')}: ${field.label}`} disabled={saving || index === 0} onClick={() => setDraft(move(draft, index, -1))}>
                        <ArrowUp className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" aria-label={`${t('winMoveDown')}: ${field.label}`} disabled={saving || index === draft.length - 1} onClick={() => setDraft(move(draft, index, 1))}>
                        <ArrowDown className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" aria-label={`${t('winDelete')}: ${field.label}`} disabled={saving} onClick={() => setDeleteIndex(index)}>
                        <Trash2 className="h-4 w-4 text-negative" aria-hidden="true" />
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {dirty && (saved.length > 0 || draft.some((f) => f.isActive && f.isRequired)) ? <FormAlert tone="warning">{t('persCartWarning')}</FormAlert> : null}
      {notice ? <FormAlert tone={notice.tone}>{notice.text}</FormAlert> : null}

      {canManage ? (
        <FormActions
          sticky={false}
          note={<span role="status">{dirty ? t('unsaved') : t('allSaved')}</span>}
          secondary={
            <Button type="button" variant="outline" disabled={!dirty || saving} onClick={() => { setDraft(saved); setNotice(null); }}>
              {t('discard')}
            </Button>
          }
          primary={
            <Button type="button" disabled={!dirty || saving} onClick={() => void onSave()}>
              {saving ? t('saving') : t('save')}
            </Button>
          }
        />
      ) : null}

      {dialog ? (
        <PersonalizationFieldDialog
          key={dialog.kind === 'edit' ? `edit-${dialog.index}` : 'add'}
          title={dialog.kind === 'add' ? t('persAdd') : canManage ? t('persEditTitle') : t('persView')}
          initial={dialog.kind === 'add' ? dialog.field : (editing as PersonalizationField)}
          others={dialog.kind === 'add' ? draft : draft.filter((_, i) => i !== dialog.index)}
          readOnly={!canManage}
          t={t}
          onClose={() => setDialog(null)}
          onApply={(field) => {
            setDraft(dialog.kind === 'add' ? [...draft, field] : draft.map((f, i) => (i === dialog.index ? field : f)));
            setDialog(null);
            setNotice(null);
          }}
        />
      ) : null}

      {deleteIndex !== null && draft[deleteIndex] ? (
        <ConfirmDialog
          title={t('persDeleteTitle')}
          message={t('persDeleteMessage', { label: draft[deleteIndex].label || draft[deleteIndex].key })}
          confirmLabel={t('winDelete')}
          cancelLabel={t('cancel')}
          busyLabel={t('saving')}
          onClose={() => setDeleteIndex(null)}
          onConfirm={async () => {
            setDraft(draft.filter((_, i) => i !== deleteIndex));
            setDeleteIndex(null);
            return null;
          }}
        />
      ) : null}
    </section>
  );
}

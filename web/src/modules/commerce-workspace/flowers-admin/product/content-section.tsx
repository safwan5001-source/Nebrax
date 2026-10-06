'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { EmptyState, FormActions, FormAlert } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import type { AdminFailure } from '../admin-http';
import { failureText } from '../failure-text';
import { flowersAdminT, type FlowersAdminMessageKey, type FlowersAdminT } from '../messages';
import { useUnsavedGuard } from '../use-unsaved-guard';
import {
  MAX_BODY_LENGTH,
  MAX_LINES,
  availableTypes,
  blockProblems,
  blockValid,
  charCount,
  contentSignature,
  lineCount,
  loadContent,
  saveContent,
  type BodyProblem,
  type ContentBlock,
  type ContentType,
} from './content';
import { move } from './personalization';
import { SectionState } from './section-state';
import { FlowersDialog } from '../flowers-dialog';

const TYPE_LABEL: Record<ContentType, FlowersAdminMessageKey> = {
  composition: 'ctTypeComposition',
  care: 'ctTypeCare',
  natural_variation: 'ctTypeNaturalVariation',
  included_items: 'ctTypeIncludedItems',
  dimensions: 'ctTypeDimensions',
  materials: 'ctTypeMaterials',
  allergens: 'ctTypeAllergens',
  storage: 'ctTypeStorage',
  preparation_notes: 'ctTypePreparationNotes',
  personalization_instructions: 'ctTypePersonalizationInstructions',
};
const TYPE_HINT: Record<ContentType, FlowersAdminMessageKey> = {
  composition: 'ctHintComposition',
  care: 'ctHintCare',
  natural_variation: 'ctHintNaturalVariation',
  included_items: 'ctHintIncludedItems',
  dimensions: 'ctHintDimensions',
  materials: 'ctHintMaterials',
  allergens: 'ctHintAllergens',
  storage: 'ctHintStorage',
  preparation_notes: 'ctHintPreparationNotes',
  personalization_instructions: 'ctHintPersonalizationInstructions',
};

const problemText = (problem: BodyProblem, t: FlowersAdminT) =>
  problem === 'required' ? t('winErrRequired') : problem === 'tooLong' ? t('ctErrTooLong', { max: MAX_BODY_LENGTH }) : t('ctErrTooManyLines', { max: MAX_LINES });

type Phase = { kind: 'loading' } | { kind: 'failed'; failure: AdminFailure } | { kind: 'ready'; saved: ContentBlock[]; revision: string | null };
type DialogState = { kind: 'add' } | { kind: 'edit'; index: number } | null;

/**
 * FLOWERS-H2-9 / ADR-17 — محتوى المنتج المهيكل: قائمة مغلقة من عشرة أنواع، كتلة واحدة لكل نوع، نصٌّ عادي فقط
 * (لا HTML)، مرتّبة وقابلة للإيقاف. نختار النوع من القائمة المغلقة (لا اختراع أنواع)، وتُحفظ المجموعة كاملةً دفعة
 * واحدة مع فحص التغيّر على الخادم. المحتوى يُقرأ في صفحة المنتج بالمتجر؛ لا أثر على السعر أو المخزون.
 */
export function ContentSection({ productId, locale, canManage, onCount }: { productId: string; locale: string | undefined; canManage: boolean; onCount?: (count: number | null) => void }) {
  const t = useMemo(() => flowersAdminT(locale), [locale]);
  const { success: toastSuccess } = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<ContentBlock[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'warning'; text: string } | null>(null);

  useEffect(() => {
    let current = true;
    setPhase({ kind: 'loading' });
    void loadContent(productId).then((result) => {
      if (!current) return;
      if (!result.ok) {
        setPhase({ kind: 'failed', failure: result });
        return;
      }
      setDraft(result.data.blocks);
      setPhase({ kind: 'ready', saved: result.data.blocks, revision: result.data.revision });
    });
    return () => {
      current = false;
    };
  }, [productId, attempt]);

  const saved = phase.kind === 'ready' ? phase.saved : [];
  const savedCount = phase.kind === 'ready' ? phase.saved.length : null;
  useEffect(() => onCount?.(savedCount), [savedCount, onCount]);
  const dirty = phase.kind === 'ready' && contentSignature(draft) !== contentSignature(saved);
  useUnsavedGuard(dirty);

  if (phase.kind !== 'ready') return <SectionState phase={phase} t={t} onRetry={() => setAttempt((n) => n + 1)} />;

  const free = availableTypes(draft);

  async function onSave() {
    if (saving || !dirty || !canManage) return;
    setSaving(true);
    setNotice(null);
    // الاستبدال كامل ⇒ التحقق من «لم يتغيّر شيء» داخل قفل الخادم (`expected_revision` ⇒ 409). الفحص المسبق احتياطٌ لخادمٍ بلا
    // بصمة، وفشل قراءته يُوقف الحفظ بدل أن يكتب من نسخة قد تكون قديمة.
    let revision = phase.kind === 'ready' ? phase.revision : null;
    if (revision === null) {
      const fresh = await loadContent(productId);
      if (!fresh.ok) {
        setSaving(false);
        setNotice({ tone: 'error', text: failureText(fresh, t) });
        return;
      }
      if (contentSignature(fresh.data.blocks) !== contentSignature(saved)) {
        setSaving(false);
        setDraft(fresh.data.blocks);
        setPhase({ kind: 'ready', saved: fresh.data.blocks, revision: fresh.data.revision });
        setNotice({ tone: 'warning', text: t('ctStale') });
        return;
      }
      // الفحص المسبق قد يعيد بصمة (نشرٌ تدريجي للخادم): نحملها إلى الـPUT فيرفض الخادم أي تعديل متزامن بعد القراءة.
      revision = fresh.data.revision;
    }
    const result = await saveContent(productId, draft, revision);
    if (!result.ok && result.kind === 'conflict') {
      const fresh = await loadContent(productId);
      setSaving(false);
      if (fresh.ok) {
        setDraft(fresh.data.blocks);
        setPhase({ kind: 'ready', saved: fresh.data.blocks, revision: fresh.data.revision });
      }
      setNotice({ tone: 'warning', text: t('ctStale') });
      return;
    }
    setSaving(false);
    if (!result.ok) {
      setNotice({ tone: 'error', text: failureText(result, t) });
      return;
    }
    setDraft(result.data.blocks);
    setPhase({ kind: 'ready', saved: result.data.blocks, revision: result.data.revision });
    toastSuccess(t('ctSaved'));
  }

  const excerpt = (text: string) => (text.length > 110 ? `${text.slice(0, 110).trimEnd()}…` : text);
  const editing = dialog?.kind === 'edit' ? draft[dialog.index] : null;

  return (
    <section aria-labelledby="ct-title" className="max-w-3xl space-y-4" data-content-section>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl space-y-1">
          <h2 id="ct-title" className="text-sm font-semibold text-text">{t('ctTitle')}</h2>
          <p className="text-xs leading-5 text-muted">{t('ctIntro')}</p>
        </div>
        {canManage ? (
          <Button type="button" className="w-full sm:w-auto" disabled={free.length === 0 || saving} onClick={() => setDialog({ kind: 'add' })}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('ctAdd')}
          </Button>
        ) : null}
      </div>
      {free.length === 0 ? <p className="text-xs text-muted">{t('ctAllUsed')}</p> : null}
      {!canManage ? <FormAlert tone="info">{t('readOnly')}</FormAlert> : null}

      {draft.length === 0 ? (
        <EmptyState icon={FileText} title={t('ctEmptyTitle')} description={t('ctEmptyDescription')} />
      ) : (
        <ul className="divide-y divide-border rounded border border-border bg-surface" data-content-list>
          {draft.map((block, index) => (
            <li key={block.type} className={cn('space-y-2 px-4 py-3 text-sm md:flex md:items-start md:justify-between md:gap-4 md:space-y-0', !block.isActive && 'text-muted')} data-content-row={block.type}>
              <div className="min-w-0 space-y-0.5">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className={cn('font-medium', block.isActive ? 'text-text' : 'text-muted')}>{t(TYPE_LABEL[block.type])}</span>
                  {!block.isActive ? <span className="text-xs">· {t('winStatusOff')}</span> : null}
                  {!blockValid(block) ? <span className="text-xs text-negative">· {t('persNeedsFix')}</span> : null}
                </p>
                <p className="whitespace-pre-line text-xs leading-5 text-muted">{excerpt(block.body)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Switch aria-label={`${t(TYPE_LABEL[block.type])}: ${t('persActive')}`} checked={block.isActive} disabled={!canManage || saving} onCheckedChange={(isActive) => setDraft(draft.map((b, i) => (i === index ? { ...b, isActive } : b)))} />
                <Button type="button" variant="ghost" size="icon" aria-label={`${canManage ? t('winEdit') : t('persView')}: ${t(TYPE_LABEL[block.type])}`} disabled={saving} onClick={() => setDialog({ kind: 'edit', index })}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
                {canManage ? (
                  <>
                    <Button type="button" variant="ghost" size="icon" aria-label={`${t('winMoveUp')}: ${t(TYPE_LABEL[block.type])}`} disabled={saving || index === 0} onClick={() => setDraft(move(draft, index, -1))}>
                      <ArrowUp className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={`${t('winMoveDown')}: ${t(TYPE_LABEL[block.type])}`} disabled={saving || index === draft.length - 1} onClick={() => setDraft(move(draft, index, 1))}>
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={`${t('winDelete')}: ${t(TYPE_LABEL[block.type])}`} disabled={saving} onClick={() => setDeleteIndex(index)}>
                      <Trash2 className="h-4 w-4 text-negative" aria-hidden="true" />
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

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
        <BlockDialog
          key={dialog.kind === 'edit' ? `edit-${dialog.index}` : 'add'}
          mode={dialog.kind}
          initial={dialog.kind === 'add' ? { type: free[0], body: '', bodyEn: '', isActive: true } : (editing as ContentBlock)}
          freeTypes={free}
          readOnly={!canManage}
          t={t}
          onClose={() => setDialog(null)}
          onApply={(block) => {
            setDraft(dialog.kind === 'add' ? [...draft, block] : draft.map((b, i) => (i === dialog.index ? block : b)));
            setDialog(null);
            setNotice(null);
          }}
        />
      ) : null}

      {deleteIndex !== null && draft[deleteIndex] ? (
        <BlockDeleteConfirm
          label={t(TYPE_LABEL[draft[deleteIndex].type])}
          t={t}
          onClose={() => setDeleteIndex(null)}
          onConfirm={() => {
            setDraft(draft.filter((_, i) => i !== deleteIndex));
            setDeleteIndex(null);
          }}
        />
      ) : null}
    </section>
  );
}

function BlockDeleteConfirm({ label, t, onClose, onConfirm }: { label: string; t: FlowersAdminT; onClose: () => void; onConfirm: () => void }) {
  return (
    <FlowersDialog open onClose={onClose} title={t('ctDeleteTitle')}>
      <div className="space-y-4">
        <p className="text-sm leading-6 text-text">{t('ctDeleteMessage', { label })}</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" autoFocus onClick={onClose}>{t('cancel')}</Button>
          <Button type="button" variant="danger" onClick={onConfirm}>{t('winDelete')}</Button>
        </div>
      </div>
    </FlowersDialog>
  );
}

function BlockDialog({
  mode,
  initial,
  freeTypes,
  readOnly,
  t,
  onClose,
  onApply,
}: {
  mode: 'add' | 'edit';
  initial: ContentBlock;
  freeTypes: readonly ContentType[];
  readOnly: boolean;
  t: FlowersAdminT;
  onClose: () => void;
  onApply: (block: ContentBlock) => void;
}) {
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const firstField = useRef<HTMLElement>(null);
  useEffect(() => firstField.current?.focus({ preventScroll: true }), []);
  const [draft, setDraft] = useState<ContentBlock>(initial);
  const [submitted, setSubmitted] = useState(false);
  const problems = blockProblems(draft);
  const patch = (next: Partial<ContentBlock>) => setDraft((current) => ({ ...current, ...next }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (readOnly || problems.body || problems.bodyEn) return;
    onApply(draft);
  }

  const bodyError = submitted && problems.body ? problemText(problems.body, t) : null;
  const enError = problems.bodyEn ? problemText(problems.bodyEn, t) : null;
  const types: ContentType[] = mode === 'add' ? [...freeTypes] : [draft.type];

  return (
    <FlowersDialog open onClose={onClose} title={mode === 'add' ? t('ctAdd') : readOnly ? t('persView') : t('ctEditTitle')} className="max-w-xl">
      <form onSubmit={submit} noValidate className="space-y-4" data-content-form>
        <div className="space-y-1.5">
          <Label htmlFor={id('type')}>{t('ctType')}</Label>
          <Select id={id('type')} value={draft.type} disabled={mode === 'edit' || readOnly} aria-describedby={id('type-hint')} onChange={(e) => patch({ type: e.target.value as ContentType })}>
            {types.map((type) => (
              <option key={type} value={type}>{t(TYPE_LABEL[type])}</option>
            ))}
          </Select>
          <p id={id('type-hint')} className="text-xs text-muted">{t(TYPE_HINT[draft.type])}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={id('body')}>{t('ctBody')}</Label>
          <Textarea
            id={id('body')}
            ref={firstField as React.Ref<HTMLTextAreaElement>}
            rows={6}
            value={draft.body}
            disabled={readOnly}
            aria-required
            aria-invalid={bodyError !== null}
            aria-describedby={bodyError ? `${id('body-count')} ${id('body-error')}` : id('body-count')}
            onChange={(e) => patch({ body: e.target.value })}
          />
          <p id={id('body-count')} className="text-xs text-muted">
            {t('ctCounter', { chars: charCount(draft.body), maxChars: MAX_BODY_LENGTH, lines: lineCount(draft.body), maxLines: MAX_LINES })}
          </p>
          {bodyError ? <p id={id('body-error')} role="alert" className="text-xs text-negative">{bodyError}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={id('body-en')}>{t('ctBodyEn')}</Label>
          <Textarea id={id('body-en')} dir="ltr" rows={4} value={draft.bodyEn} disabled={readOnly} aria-invalid={enError !== null} aria-describedby={enError ? id('body-en-error') : undefined} onChange={(e) => patch({ bodyEn: e.target.value })} />
          {enError ? <p id={id('body-en-error')} role="alert" className="text-xs text-negative">{enError}</p> : null}
        </div>

        <p className="text-xs text-muted">{t('ctPlainText')}</p>

        <div className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2.5">
          <span id={id('active')} className="text-sm font-medium text-text">{t('persActive')}</span>
          <Switch aria-labelledby={id('active')} checked={draft.isActive} disabled={readOnly} onCheckedChange={(isActive) => patch({ isActive })} />
        </div>

        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>{readOnly ? t('close') : t('cancel')}</Button>
          {!readOnly ? <Button type="submit">{t('persApply')}</Button> : null}
        </div>
      </form>
    </FlowersDialog>
  );
}

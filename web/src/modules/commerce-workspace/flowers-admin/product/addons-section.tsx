'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Gift, Plus, Trash2 } from 'lucide-react';
import { EmptyState, FormActions, FormAlert } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { formatRiyal } from '@/lib/money';
import { cn } from '@/lib/utils';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { ProductPicker, type PickerProduct } from '@/modules/commerce-workspace/merchandising/product-picker';
import type { AdminFailure } from '../admin-http';
import { failureText } from '../failure-text';
import { flowersAdminT } from '../messages';
import { useUnsavedGuard } from '../use-unsaved-guard';
import {
  MAX_ADDONS,
  MAX_ADDON_QUANTITY,
  addonsSignature,
  canAdd,
  loadAddons,
  loadCandidate,
  loadVariants,
  rowProblem,
  saveAddons,
  type AddonCandidate,
  type AddonRow,
  type AddonVariantOption,
} from './addons';
import { move } from './personalization';
import { SectionState } from './section-state';

type Phase = { kind: 'loading' } | { kind: 'failed'; failure: AdminFailure } | { kind: 'ready'; saved: AddonRow[] };
type Context = { price: string | null; variantLabel: string | null };
type Pending =
  | { kind: 'loading'; product: PickerProduct }
  | { kind: 'ready'; candidate: AddonCandidate; variants: AddonVariantOption[] | null; variantId: string }
  | { kind: 'failed' }
  | null;

/**
 * FLOWERS-H2-8 / ADR-18 — إضافات المنتج. الإضافة منتجٌ حقيقي يُختار بالبحث ضمن منتجات المستأجر (المنتقي نفسه الموثوق
 * في «التسويق»)، ولا يُرسَل ولا يُخزَّن أي سعر: السعر المعروض قراءةٌ فقط من المنتج. متعدد الخيارات يُلزَم بمتغيّر قبل
 * الإضافة؛ المنتج غير النشط لا يُضاف. التعديلات تُجمَّع محلياً وتُحفظ بـPUT كامل مع فحص التغيّر على الخادم.
 */
export function AddonsSection({ productId, locale, canManage }: { productId: string; locale: string | undefined; canManage: boolean }) {
  const t = useMemo(() => flowersAdminT(locale), [locale]);
  const tm = useMemo(() => (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage(locale, key), [locale]);
  const { success: toastSuccess } = useToast();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<AddonRow[]>([]);
  const [context, setContext] = useState<Record<string, Context>>({});
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'warning'; text: string } | null>(null);

  useEffect(() => {
    let current = true;
    setPhase({ kind: 'loading' });
    void loadAddons(productId).then((result) => {
      if (!current) return;
      if (!result.ok) {
        setPhase({ kind: 'failed', failure: result });
        return;
      }
      setDraft(result.data);
      setPhase({ kind: 'ready', saved: result.data });
    });
    return () => {
      current = false;
    };
  }, [productId, attempt]);

  // سياق القراءة (السعر + اسم المتغيّر) للصفوف الحالية؛ فشله يعرض «—» ولا يمنع شيئاً.
  const contextKey = draft.map((r) => `${r.addonProductId}:${r.addonVariantId ?? ''}`).join('|');
  useEffect(() => {
    let current = true;
    for (const row of draft) {
      const key = `${row.addonProductId}:${row.addonVariantId ?? ''}`;
      if (context[key]) continue;
      void (async () => {
        const [candidate, variants] = await Promise.all([loadCandidate(row.addonProductId), row.addonVariantId ? loadVariants(row.addonProductId) : Promise.resolve(null)]);
        if (!current) return;
        const variantLabel = variants && variants.ok ? (variants.data.find((v) => v.id === row.addonVariantId)?.label ?? null) : null;
        setContext((existing) => ({ ...existing, [key]: { price: candidate.ok ? candidate.data.price : null, variantLabel } }));
      })();
    }
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey]);

  const saved = phase.kind === 'ready' ? phase.saved : [];
  const dirty = phase.kind === 'ready' && addonsSignature(draft) !== addonsSignature(saved);
  useUnsavedGuard(dirty);

  if (phase.kind !== 'ready') return <SectionState phase={phase} t={t} onRetry={() => setAttempt((n) => n + 1)} />;

  const blocked = draft.filter((row) => rowProblem(row) !== null).length;
  const limitReached = draft.length >= MAX_ADDONS;
  const patchRow = (index: number, next: Partial<AddonRow>) => setDraft(draft.map((row, i) => (i === index ? { ...row, ...next } : row)));

  async function pick(product: PickerProduct) {
    const problem = canAdd(draft, productId, product.id);
    if (problem) {
      setNotice({ tone: 'error', text: problem === 'self' ? t('addonErrSelf') : problem === 'duplicate' ? t('addonErrDuplicate') : t('addonLimit', { max: MAX_ADDONS }) });
      return;
    }
    setNotice(null);
    setPending({ kind: 'loading', product });
    const candidate = await loadCandidate(product.id);
    if (!candidate.ok) {
      setPending({ kind: 'failed' });
      return;
    }
    let variants: AddonVariantOption[] | null = null;
    if (candidate.data.variantManaged) {
      const loaded = await loadVariants(product.id);
      if (!loaded.ok) {
        setPending({ kind: 'failed' });
        return;
      }
      variants = loaded.data.filter((v) => v.isActive);
    }
    setPending({ kind: 'ready', candidate: candidate.data, variants, variantId: '' });
  }

  function confirmPending() {
    if (!pending || pending.kind !== 'ready') return;
    const { candidate, variants, variantId } = pending;
    if (!candidate.isActive || (variants !== null && variantId === '')) return;
    setDraft([...draft, { addonProductId: candidate.id, addonVariantId: variants !== null ? variantId : null, name: candidate.name, nameEn: candidate.nameEn, sku: candidate.sku, productIsActive: true, maxQuantity: 1, isActive: true }]);
    setPending(null);
    setAdding(false);
  }

  async function onSave() {
    if (saving || !dirty || !canManage) return;
    if (blocked > 0) {
      setNotice({ tone: 'error', text: t('addonFixInactive') });
      return;
    }
    setSaving(true);
    setNotice(null);
    const fresh = await loadAddons(productId);
    if (fresh.ok && addonsSignature(fresh.data) !== addonsSignature(saved)) {
      setSaving(false);
      setDraft(fresh.data);
      setPhase({ kind: 'ready', saved: fresh.data });
      setNotice({ tone: 'warning', text: t('addonStale') });
      return;
    }
    const result = await saveAddons(productId, draft);
    setSaving(false);
    if (!result.ok) {
      setNotice({ tone: 'error', text: failureText(result, t) });
      return;
    }
    setDraft(result.data);
    setPhase({ kind: 'ready', saved: result.data });
    toastSuccess(t('addonSaved'));
  }

  return (
    <section aria-labelledby="addon-title" className="max-w-3xl space-y-4" data-addons-section>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl space-y-1">
          <h2 id="addon-title" className="text-sm font-semibold text-text">{t('addonTitle')}</h2>
          <p className="text-xs leading-5 text-muted">{t('addonIntro')}</p>
        </div>
        {canManage ? (
          <Button type="button" className="w-full sm:w-auto" disabled={limitReached || saving} onClick={() => { setAdding((v) => !v); setPending(null); setNotice(null); }}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('addonAdd')}
          </Button>
        ) : null}
      </div>
      {limitReached ? <p className="text-xs text-muted">{t('addonLimit', { max: MAX_ADDONS })}</p> : null}
      {!canManage ? <FormAlert tone="info">{t('readOnly')}</FormAlert> : null}

      {adding && canManage ? (
        <div className="space-y-3 rounded border border-border bg-surface p-4" data-addon-picker>
          <h3 className="text-sm font-medium text-text">{t('addonPickTitle')}</h3>
          <ProductPicker t={tm} idPrefix="addon-picker" actionLabel={t('addonChoose')} excludeIds={[productId, ...draft.map((r) => r.addonProductId)]} disabled={pending?.kind === 'loading'} onPick={(product) => void pick(product)} />
          {pending?.kind === 'loading' ? <p role="status" className="text-xs text-muted">{t('loading')}</p> : null}
          {pending?.kind === 'failed' ? <FormAlert tone="error">{t('addonCandidateFailed')}</FormAlert> : null}
          {pending?.kind === 'ready' ? (
            <div className="space-y-3 rounded border border-primary/40 bg-primary-soft/40 p-3" data-addon-candidate>
              <p className="text-sm font-medium text-text">{pending.candidate.name}</p>
              <p className="text-xs text-muted">
                {pending.candidate.sku ? <bdi className="me-2 font-mono">{pending.candidate.sku}</bdi> : null}
                {pending.candidate.price !== null ? <span>{t('addonPrice')}: <bdi className="num text-text">{formatRiyal(pending.candidate.price)}</bdi></span> : null}
              </p>
              <p className="text-xs text-muted">{t('addonPriceNote')}</p>
              {!pending.candidate.isActive ? <FormAlert tone="warning">{t('addonErrInactive')}</FormAlert> : null}
              {pending.variants !== null ? (
                <div className="space-y-1.5">
                  <Label htmlFor="addon-variant">{t('addonVariant')}</Label>
                  <Select id="addon-variant" value={pending.variantId} onChange={(e) => setPending({ ...pending, variantId: e.target.value })}>
                    <option value="">{t('addonVariantPlaceholder')}</option>
                    {pending.variants.map((v) => (
                      <option key={v.id} value={v.id}>{v.label}</option>
                    ))}
                  </Select>
                  <p className="text-xs text-muted">{t('addonVariantHint')}</p>
                </div>
              ) : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setPending(null)}>{t('cancel')}</Button>
                <Button type="button" disabled={!pending.candidate.isActive || (pending.variants !== null && pending.variantId === '')} onClick={confirmPending}>{t('addonConfirm')}</Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {draft.length === 0 ? (
        <EmptyState icon={Gift} title={t('addonEmptyTitle')} description={t('addonEmptyDescription')} />
      ) : (
        <ul className="divide-y divide-border rounded border border-border bg-surface" data-addons-list>
          {draft.map((row, index) => {
            const key = `${row.addonProductId}:${row.addonVariantId ?? ''}`;
            const info = context[key];
            const problem = rowProblem(row);
            return (
              <li key={key} className={cn('space-y-2 px-4 py-3 text-sm md:flex md:items-center md:justify-between md:gap-4 md:space-y-0', !row.isActive && 'text-muted')} data-addon-row={row.addonProductId}>
                <div className="min-w-0 space-y-0.5">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className={cn('font-medium', row.isActive ? 'text-text' : 'text-muted')}>{row.name}</span>
                    {info?.variantLabel ? <span className="text-xs">· {info.variantLabel}</span> : row.addonVariantId ? <span className="text-xs">· {t('addonVariantShort')}</span> : null}
                    {problem ? <span className="text-xs text-negative">· {t('addonProductInactive')}</span> : null}
                    {!row.isActive ? <span className="text-xs">· {t('winStatusOff')}</span> : null}
                  </p>
                  <p className="text-xs text-muted">
                    {row.sku ? <bdi className="me-2 font-mono">{row.sku}</bdi> : null}
                    {t('addonPrice')}: {info?.price != null ? <bdi className="num">{formatRiyal(info.price)}</bdi> : '—'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 md:shrink-0">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor={`addon-qty-${index}`} className="text-xs text-muted">{t('addonMaxQty')}</Label>
                    <Select id={`addon-qty-${index}`} className="h-8 w-16" value={String(row.maxQuantity)} disabled={!canManage || saving} onChange={(e) => patchRow(index, { maxQuantity: Number(e.target.value) })}>
                      {Array.from({ length: MAX_ADDON_QUANTITY }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch aria-label={`${row.name}: ${t('addonActive')}`} checked={row.isActive} disabled={!canManage || saving} onCheckedChange={(isActive) => patchRow(index, { isActive })} />
                    <span className="text-xs">{row.isActive ? t('winStatusActive') : t('winStatusOff')}</span>
                  </div>
                  {canManage ? (
                    <div className="flex items-center gap-0.5">
                      <Button type="button" variant="ghost" size="icon" aria-label={`${t('winMoveUp')}: ${row.name}`} disabled={saving || index === 0} onClick={() => setDraft(move(draft, index, -1))}>
                        <ArrowUp className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" aria-label={`${t('winMoveDown')}: ${row.name}`} disabled={saving || index === draft.length - 1} onClick={() => setDraft(move(draft, index, 1))}>
                        <ArrowDown className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" aria-label={`${t('addonRemove')}: ${row.name}`} disabled={saving} onClick={() => setDraft(draft.filter((_, i) => i !== index))}>
                        <Trash2 className="h-4 w-4 text-negative" aria-hidden="true" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
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
    </section>
  );
}

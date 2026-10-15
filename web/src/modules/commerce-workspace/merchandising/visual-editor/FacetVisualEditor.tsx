'use client';

/**
 * AWJ-VD-H1 / VD-3 — the facet visual editor: one side sheet for a dimension or a value, replacing the two-field dialog.
 *
 * Container (UX requirements §3.2): a side `Sheet` (`max-w-3xl` from `md`, fields beside a sticky preview) that is a
 * full-screen sheet on a phone — tabs pinned on top, a collapsible preview strip, and the actions pinned at the bottom
 * with the safe-area inset. Three tabs: Data · Image & icon · Appearance.
 *
 * Saving (§3.7): one button writes the data (if it changed) and then the visual identity (if it changed), with the
 * `expected_version` read when the editor opened. Each part's outcome is shown beside its tab; the editor closes only
 * when everything succeeded. A 409/428 never retries over a version the user has not seen — it offers a reload. A 422
 * puts the server's field errors on their controls. The submit is guarded against double clicks.
 *
 * Permissions (§3.8, D-04) mirror the server and never replace it:
 *   products.manage + commerce.manage → everything editable;
 *   products.manage only              → Data editable, identity tabs read-only, previews from the signed `visual_preview`
 *                                       thumbnail (no library read, no pick or upload);
 *   products.view only                → everything read-only.
 * The media-library capability probe runs only for a role that may use the library.
 */

import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useRestoreFocus } from '@/lib/use-restore-focus';
import { FacetVisualTile } from '@/modules/store-experience-builder/FacetVisualTile';
import { type MediaCapability, useMediaCapability } from '@/modules/store-experience-builder/media/use-media-capability';
import {
  type FacetVisual,
  type ResolvedFacetVisual,
  resolveFacetSelfVisual,
  resolveFacetValueVisual,
} from '@/modules/store-experience-builder/presentation/facet-visual';
import { type Facet, type FacetValue, saveFacetValueVisual, saveFacetVisual, updateFacet, updateFacetValue } from '../client';
import { ConfirmDialog, type T, writeFailureMessage } from '../common';
import { AppearanceTab } from './AppearanceTab';
import { DataTab, type DataDraft, dataFromTarget, sameData } from './DataTab';
import {
  changedGroups,
  choiceOf,
  documentOf,
  draftFromStored,
  type EditorTab,
  type IndexedErrors,
  indexVisualErrors,
  payloadOf,
  pruneErrors,
  sameVisual,
  setFraming,
  tabsWithErrors,
  type VisualDraft,
} from './document';
import { ImageTab } from './ImageTab';
import { imageNoteKey } from './labels';
import { createVisualEditorT, fieldErrorMessage, type VisualEditorMessageKey } from './messages';
import { PreviewPanel, type PreviewGroup, type PreviewItem } from './PreviewPanel';
import type { EditorTarget, IdentityTabProps, MediaAvailability } from './types';
import { previewImage, useFacetImageSource } from './use-image-source';

export interface FacetVisualEditorProps {
  target: EditorTarget;
  locale: 'ar' | 'en';
  /** The workspace catalog's translator (existing wording: «save», «cancel», «no permission»…). */
  t: T;
  /** `products.manage` — may write names and the active switch. */
  canManageData: boolean;
  /** `commerce.manage` — may write the visual identity and use the media library. */
  canManageIdentity: boolean;
  initialTab?: EditorTab;
  /** The editor was closed without finishing; `changed` says a part had already been saved, so the list is stale. */
  onClose: (changed: boolean) => void;
  /** Everything was saved: the parent refreshes its list, shows the confirmation and closes the editor. */
  onSaved: () => void | Promise<void>;
  /** The user chose to reload after a version conflict: the parent reopens the editor, on this tab, on fresh data. */
  onReload: (tab: EditorTab) => void;
  /**
   * Where focus goes on close when the element that opened the editor is gone (a quick-add follow-up button that was
   * replaced by the editor): the list row's own edit button.
   */
  returnFocusTo?: () => HTMLElement | null;
}

type PartStatus =
  | { status: 'idle' }
  | { status: 'saved' }
  | { status: 'failed'; message: string; conflict?: boolean; reload?: boolean; fields?: boolean };

const IDLE: PartStatus = { status: 'idle' };
const NO_ERRORS: IndexedErrors = { byField: {}, unmapped: [] };

function useIsDesktop(): boolean {
  const query = '(min-width: 768px)';
  const read = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : true);
  const [desktop, setDesktop] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const onChange = () => setDesktop(media.matches);
    onChange();
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);
  return desktop;
}

/** Calls the media-capability probe — only mounted for a role that may read the library (no probe, no 403 otherwise). */
function WithMediaCapability({ children }: { children: (capability: MediaCapability) => ReactNode }) {
  return <>{children(useMediaCapability())}</>;
}

export function FacetVisualEditor(props: FacetVisualEditorProps) {
  const identityEditable = props.canManageData && props.canManageIdentity;
  if (!identityEditable) return <EditorBody {...props} identityEditable={false} media="gated" />;
  return (
    <WithMediaCapability>
      {(capability) => <EditorBody {...props} identityEditable media={capability} />}
    </WithMediaCapability>
  );
}

function storedDocOf(target: EditorTarget): FacetVisual | NonNullable<FacetValue['visual']> | null {
  return target.kind === 'facet' ? target.facet.visual : target.value.visual;
}

function storedImageId(target: EditorTarget): string | null {
  const doc = storedDocOf(target);
  if (!doc) return null;
  return (target.kind === 'facet' ? (doc as FacetVisual).self?.image?.mediaId : (doc as FacetValue['visual'] & object).image?.mediaId) ?? null;
}

function EditorBody({
  target,
  locale,
  t,
  canManageData,
  canManageIdentity,
  initialTab,
  onClose,
  onSaved,
  onReload,
  returnFocusTo,
  identityEditable,
  media,
}: FacetVisualEditorProps & { identityEditable: boolean; media: MediaAvailability }) {
  const vt = useMemo(() => createVisualEditorT(locale), [locale]);
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const kind = target.kind;
  const desktop = useIsDesktop();

  const [baseline, setBaseline] = useState(() => ({
    data: dataFromTarget(target),
    draft: draftFromStored(kind, storedDocOf(target)),
    version: (target.kind === 'facet' ? target.facet.visualVersion : target.value.visualVersion) as number | null,
  }));
  const [data, setData] = useState<DataDraft>(baseline.data);
  const [draft, setDraft] = useState<VisualDraft>(baseline.draft);
  const [tab, setTab] = useState<EditorTab>(initialTab ?? 'data');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // A part saved before a later part failed: closing afterwards must still refresh the list behind the editor.
  const savedAnyRef = useRef(false);
  const [dataResult, setDataResult] = useState<PartStatus>(IDLE);
  const [visualResult, setVisualResult] = useState<PartStatus>(IDLE);
  const [visualErrors, setVisualErrors] = useState<IndexedErrors>(NO_ERRORS);
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // The ref is the draft's source of truth between renders, so two changes in one event never overwrite each other and a
  // field error is cleared exactly when the value of the control it belongs to changes.
  const draftRef = useRef(draft);
  const update = useCallback((change: (current: VisualDraft) => VisualDraft) => {
    const before = draftRef.current;
    const after = change(before);
    if (after === before) return;
    draftRef.current = after;
    setDraft(after);
    setVisualErrors((errors) => pruneErrors(errors, changedGroups(before, after)));
  }, []);

  // Once the last field error is corrected the «some settings are invalid» line has nothing left to point at.
  useEffect(() => {
    if (
      visualResult.status === 'failed' &&
      visualResult.fields &&
      Object.keys(visualErrors.byField).length === 0 &&
      visualErrors.unmapped.length === 0
    ) {
      setVisualResult(IDLE);
    }
  }, [visualErrors, visualResult]);

  // Focus returns to whatever opened the editor (the sheet has no Trigger for Radix to return it to).
  const restoreOpener = useRestoreFocus();
  const onCloseAutoFocus = useCallback(
    (event: Event) => {
      restoreOpener(event);
      if (event.defaultPrevented) return;
      const fallback = returnFocusTo?.();
      if (fallback?.isConnected) {
        event.preventDefault();
        fallback.focus();
      }
    },
    [restoreOpener, returnFocusTo],
  );

  const dataDirty = canManageData && !sameData(data, baseline.data);
  const visualDirty = identityEditable && !sameVisual(kind, draft, baseline.draft);
  const dirty = dataDirty || visualDirty;

  // ── preview inputs ────────────────────────────────────────────────────────────
  const facet: Facet = target.facet;
  const facetVisual = facet.visual;
  const mediaId = draft.own.image?.mediaId ?? null;
  const own = target.kind === 'facet' ? target.facet : target.value;
  const imageSource = useFacetImageSource({
    mediaId,
    storedMediaId: storedImageId(target),
    storedPreview: own.visualPreview,
    canReadLibrary: identityEditable,
  });

  const displayName = (name: string, nameEn: string | null) => (locale === 'en' && nameEn ? nameEn : name);
  const editedLabel = displayName(data.name.trim() || own.name, data.nameEn.trim() || null);

  const groups = useMemo<PreviewGroup[]>(() => {
    const editedImage = imageSource.image;
    if (target.kind === 'value') {
      const resolved = resolveFacetValueVisual(facetVisual ?? {}, draft.own).visual;
      const siblings = facet.values.filter((v) => v.isActive || v.id === target.value.id);
      const index = siblings.findIndex((v) => v.id === target.value.id);
      const neighbour = (v: FacetValue | undefined): PreviewItem[] =>
        v
          ? [
              {
                id: v.id,
                label: displayName(v.name, v.nameEn),
                visual: resolveFacetValueVisual(facetVisual ?? {}, v.visual ?? {}).visual,
                image: previewImage(v.visualPreview),
              },
            ]
          : [];
      return [
        {
          id: 'values',
          items: [
            ...neighbour(index > 0 ? siblings[index - 1] : undefined),
            { id: target.value.id, label: editedLabel, visual: resolved, image: editedImage, edited: true },
            ...neighbour(index >= 0 ? siblings[index + 1] : undefined),
          ],
        },
      ];
    }
    const doc = documentOf('facet', draft) as FacetVisual;
    const self: ResolvedFacetVisual = resolveFacetSelfVisual(doc).visual;
    return [
      {
        id: 'self',
        title: vt('previewFacetSelf'),
        items: [{ id: target.facet.id, label: editedLabel, visual: self, image: editedImage, edited: true }],
      },
      {
        id: 'values',
        title: vt('previewFacetValues'),
        items: facet.values
          .filter((v) => v.isActive)
          .slice(0, 4)
          .map((v) => ({
            id: v.id,
            label: displayName(v.name, v.nameEn),
            visual: resolveFacetValueVisual(doc, v.visual ?? {}).visual,
            image: previewImage(v.visualPreview),
          })),
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `displayName` closes over `locale` only
  }, [target, facet, facetVisual, draft, editedLabel, imageSource.image, vt, locale]);

  const editedItem = groups.flatMap((g) => g.items).find((item) => item.edited);
  const showsImage = draft.own.image !== undefined && choiceOf(draft.own, kind === 'value' ? 'value' : 'self') === 'image';
  const noteKey = showsImage ? imageNoteKey(imageSource.state) : null;
  const dragEnabled = identityEditable && tab === 'appearance' && showsImage && imageSource.state === 'ready';
  const notes = [
    ...(noteKey ? [vt(noteKey)] : []),
    ...(dragEnabled ? [vt('previewDragHint')] : []),
    ...(target.kind === 'value' && groups[0].items.length === 1 ? [vt('previewAlone')] : []),
  ];

  // ── closing ───────────────────────────────────────────────────────────────────
  const requestClose = useCallback(() => {
    if (savingRef.current) return;
    if (dirty) setConfirmDiscard(true);
    else onClose(savedAnyRef.current);
  }, [dirty, onClose]);

  // ── saving ────────────────────────────────────────────────────────────────────
  async function save() {
    if (savingRef.current || !dirty) return;
    if (dataDirty && data.name.trim() === '') {
      setNameError(t('merchNameRequired'));
      setTab('data');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setNameError(null);
    setDataResult(IDLE);
    setVisualResult(IDLE);
    setVisualErrors(NO_ERRORS);
    let allSaved = true;
    try {
      if (dataDirty) {
        const patch = { name: data.name.trim(), nameEn: data.nameEn.trim() || null, isActive: data.isActive };
        const result =
          target.kind === 'facet'
            ? await updateFacet(target.facet.id, patch)
            : await updateFacetValue(target.facet.id, target.value.id, patch);
        if (result.ok) {
          savedAnyRef.current = true;
          setBaseline((b) => ({ ...b, data: { ...data } }));
          setDataResult({ status: 'saved' });
        } else {
          allSaved = false;
          setDataResult({ status: 'failed', message: writeFailureMessage(result, t) });
        }
      }

      if (visualDirty) {
        const payload = payloadOf(kind, draft);
        const result =
          target.kind === 'facet'
            ? await saveFacetVisual(target.facet.id, payload as FacetVisual | null, baseline.version)
            : await saveFacetValueVisual(target.facet.id, target.value.id, payload as NonNullable<FacetValue['visual']> | null, baseline.version);
        if (result.ok) {
          savedAnyRef.current = true;
          setBaseline((b) => ({ ...b, draft: structuredCloneDraft(draft), version: result.version }));
          setVisualResult({ status: 'saved' });
        } else {
          allSaved = false;
          // Each refusal has its own words; none is retried automatically.
          const status = result.status;
          if (status === 409 || status === 428) {
            setVisualResult({ status: 'failed', message: vt('versionConflict'), conflict: true, reload: true });
          } else if (status === 404) {
            setVisualResult({ status: 'failed', message: vt('visualNotFound'), reload: true });
          } else if (status === 422) {
            const indexed = indexVisualErrors(kind, result.errors);
            setVisualErrors(indexed);
            setVisualResult({ status: 'failed', message: vt('visualInvalid'), fields: true });
          } else if (status === 403) {
            setVisualResult({ status: 'failed', message: vt('identityReadOnly') });
          } else if (status === 429) {
            setVisualResult({ status: 'failed', message: vt('visualTooMany') });
          } else if (status !== null && status >= 500) {
            setVisualResult({ status: 'failed', message: vt('visualServerError') });
          } else if (status === null) {
            setVisualResult({ status: 'failed', message: vt('visualNetworkError') });
          } else {
            setVisualResult({ status: 'failed', message: t('merchSaveFailed') });
          }
        }
      }

      if (allSaved) await onSaved();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  // ── tab alerts ────────────────────────────────────────────────────────────────
  const visualFailed = visualResult.status === 'failed';
  const mappedTabs = tabsWithErrors(visualErrors);
  // A failure with field errors flags the tabs that still hold one; any other failure flags both identity tabs.
  const fieldFailure = visualResult.status === 'failed' && visualResult.fields === true;
  const identityAlert = (which: 'image' | 'appearance') =>
    visualFailed && (fieldFailure ? mappedTabs.has(which) : true);
  const alerts: Record<EditorTab, boolean> = {
    data: dataResult.status === 'failed' || nameError !== null,
    image: identityAlert('image'),
    appearance: identityAlert('appearance'),
  };

  const identityProps: IdentityTabProps = {
    kind,
    locale,
    t: vt,
    draft,
    baseline: baseline.draft,
    update,
    facetVisual,
    readOnly: !identityEditable,
    busy: saving,
    errors: visualErrors,
    media,
    imageSource,
  };

  const title = `${canManageData ? vt(kind === 'facet' ? 'titleFacet' : 'titleValue') : vt(kind === 'facet' ? 'viewFacet' : 'viewValue')} — ${
    displayName(baseline.data.name, baseline.data.nameEn || null)
  }`;
  const identifier = target.kind === 'facet' ? target.facet.key : target.value.slug;

  const identityBanner =
    canManageData && !canManageIdentity && tab !== 'data' ? (
      <p role="note" className="rounded border border-border bg-primary-soft px-3 py-2 text-xs leading-5 text-text" data-identity-banner="">
        {vt('identityReadOnly')}
      </p>
    ) : null;
  const permissionBanner = !canManageData ? (
    <p role="note" className="rounded border border-border bg-surface px-3 py-2 text-xs leading-5 text-muted" data-permission-banner="">
      {t('merchNoPermission')}
    </p>
  ) : null;

  const panel =
    tab === 'data' ? (
      <DataTab
        target={target}
        data={data}
        onChange={setData}
        readOnly={!canManageData || saving}
        nameError={nameError}
        coreLabel={t('merchCoreBadge')}
        t={vt}
      />
    ) : tab === 'image' ? (
      <ImageTab {...identityProps} />
    ) : (
      <AppearanceTab {...identityProps} />
    );

  const previewNode = (
    <PreviewPanel
      t={vt}
      groups={groups}
      notes={notes}
      dragEnabled={dragEnabled && !saving}
      onFocal={(focal) => update((d) => setFraming(d, { focal }))}
      dir={dir}
      showTitle={desktop}
    />
  );

  // Every server field error is also listed here, so one on a control that is not on screen (another tab, a section
  // that is collapsed away) is never invisible.
  const GROUP_LABEL: Record<string, VisualEditorMessageKey> = {
    content: 'contentTitle',
    image: 'imageTitle',
    icon: 'iconTitle',
    iconColor: 'iconColour',
    background: 'backgroundColour',
    shape: 'shapeTitle',
    size: 'sizeTitle',
    showLabel: 'showLabelTitle',
    fit: 'fitTitle',
    focal: 'focalTitle',
    zoom: 'zoomTitle',
  };
  const errorLines = Object.entries(visualErrors.byField).map(([key, codes]) => {
    const [scope, group] = key.split(':');
    const prefix = kind === 'facet' ? `${vt(scope === 'defaults' ? 'defaultsSection' : 'selfSection')} — ` : '';
    return { key, text: `${prefix}${vt(GROUP_LABEL[group])}: ${[...new Set(codes)].map((c) => fieldErrorMessage(vt, c)).join(' ')}` };
  });

  const failedParts: { key: string; label: string; status: PartStatus }[] = [
    { key: 'data', label: vt('partData'), status: dataResult },
    { key: 'visual', label: vt('partVisual'), status: visualResult },
  ];
  const summary = failedParts.filter((p) => p.status.status !== 'idle');

  return (
    <Sheet open onOpenChange={(open) => !open && requestClose()}>
      <SheetContent
        closeLabel={t('merchClose')}
        dir={dir}
        className="sm:max-w-full md:max-w-3xl [&>button:last-child]:size-11"
        onCloseAutoFocus={onCloseAutoFocus}
        data-facet-visual-editor={kind}
      >
        <div className="shrink-0 space-y-1 border-b border-border px-4 pb-3 pt-4 pe-14">
          <SheetTitle className="line-clamp-2 break-words text-base font-semibold text-text" title={title}>
            {title}
          </SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <code dir="ltr" className="rounded bg-primary-soft px-1.5 py-0.5">
              {identifier}
            </code>
            {target.kind === 'value' ? <span className="break-words">{displayName(facet.name, facet.nameEn)}</span> : null}
          </SheetDescription>
        </div>

        <Tabs
          className="shrink-0 bg-surface"
          tabs={[
            { id: 'data', label: vt('tabData'), alert: alerts.data, alertLabel: vt('tabHasError') },
            { id: 'image', label: vt('tabImage'), alert: alerts.image, alertLabel: vt('tabHasError') },
            { id: 'appearance', label: vt('tabAppearance'), alert: alerts.appearance, alertLabel: vt('tabHasError') },
          ]}
          value={tab}
          onChange={(id) => setTab(id as EditorTab)}
        />

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {!desktop ? (
            <div className="border-b border-border bg-surface" data-preview-strip="">
              <button
                type="button"
                aria-expanded={previewOpen}
                aria-controls="ve-preview-strip"
                onClick={() => setPreviewOpen((open) => !open)}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-4 text-sm font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <span className="flex min-w-0 items-center gap-3">
                  {editedItem && editedItem.visual.content !== 'none' ? (
                    <span aria-hidden="true" className="awj-store-preview flex size-9 shrink-0 items-center justify-center rounded !bg-transparent" dir={dir}>
                      <span className="block w-8 [&_[data-facet-content]>span:last-child]:sr-only">
                        <FacetVisualTile visual={{ ...editedItem.visual, showLabel: false }} label={editedItem.label} image={editedItem.image} className="w-full" />
                      </span>
                    </span>
                  ) : null}
                  {vt('previewStrip')}
                </span>
                {previewOpen ? <ChevronUp className="size-4" strokeWidth={1.7} aria-hidden="true" /> : <ChevronDown className="size-4" strokeWidth={1.7} aria-hidden="true" />}
              </button>
              {previewOpen ? (
                <div id="ve-preview-strip" className="px-4 pb-4">
                  {previewNode}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className={cn('p-4', desktop && 'grid grid-cols-[minmax(0,1fr)_17rem] items-start gap-6')}>
            <div className="min-w-0 space-y-4">
              {permissionBanner}
              {identityBanner}
              <TabPanel id={tab}>{panel}</TabPanel>
            </div>
            {desktop ? <aside className="sticky top-4 min-w-0 self-start">{previewNode}</aside> : null}
          </div>
        </div>

        <div className="shrink-0 space-y-2 border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {summary.length > 0 ? (
            <ul aria-live="polite" className="space-y-1" data-save-results="">
              {summary.map(({ key, label, status }) => (
                <li key={key} data-save-part={key} data-save-status={status.status} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {status.status === 'failed' ? (
                    <>
                      <AlertCircle className="size-3.5 shrink-0 text-negative" strokeWidth={1.7} aria-hidden="true" />
                      <span role="alert" className="min-w-0 break-words text-negative">
                        <span className="font-medium">{label}:</span> {status.message}
                      </span>
                      {status.reload ? (
                        <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => onReload(tab)}>
                          {vt('reload')}
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted">
                      <span className="font-medium">{label}:</span> {vt('partSaved')}
                    </span>
                  )}
                </li>
              ))}
              {visualResult.status === 'failed' && visualResult.conflict ? (
                <li className="text-xs text-muted">{vt('reloadHint')}</li>
              ) : null}
              {errorLines.map((line) => (
                // Visual only: the control itself announces its error, so a screen reader hears it once.
                <li key={line.key} aria-hidden="true" className="break-words text-xs text-negative" data-visual-error={line.key}>
                  {line.text}
                </li>
              ))}
              {visualErrors.unmapped.length > 0 ? (
                <li className="break-words text-xs text-negative">
                  {[...new Set(visualErrors.unmapped)].map((code) => fieldErrorMessage(vt, code)).join(' ')}
                </li>
              ) : null}
            </ul>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" className="min-h-11 min-w-24" onClick={requestClose} disabled={saving}>
              {t('merchCancel')}
            </Button>
            <Button
              type="button"
              className="min-h-11 min-w-24"
              onClick={() => void save()}
              disabled={saving || !dirty || (!canManageData && !identityEditable)}
              data-save=""
            >
              {saving ? vt('saving') : t('merchSave')}
            </Button>
          </div>
        </div>

        {confirmDiscard ? (
          <ConfirmDialog
            t={t}
            title={vt('unsavedTitle')}
            message={vt('unsavedMessage')}
            confirmLabel={vt('unsavedDiscard')}
            onClose={() => setConfirmDiscard(false)}
            onConfirm={async () => {
              setConfirmDiscard(false);
              onClose(savedAnyRef.current);
              return null;
            }}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** A detached copy of the draft: the baseline must not alias what the user keeps editing. */
function structuredCloneDraft(draft: VisualDraft): VisualDraft {
  return JSON.parse(JSON.stringify(draft)) as VisualDraft;
}

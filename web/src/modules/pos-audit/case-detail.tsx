'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarClock, Camera, ClipboardList, FileText, Link2, ShieldQuestion, UserCog } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { casePriorityTone, caseStatusTone, formatDateTime } from './helpers';
import type { CasePriority, CaseStatus, CaseTimeline, InvestigationCaseRow } from './types';

const OUTCOME_STATES: CaseStatus[] = ['explained', 'control_failure', 'confirmed_loss', 'dismissed', 'closed'];

const NEXT_STATES: Record<CaseStatus, CaseStatus[]> = {
  open: ['investigating', 'awaiting_information', 'explained', 'control_failure', 'confirmed_loss', 'dismissed', 'closed'],
  investigating: ['open', 'awaiting_information', 'explained', 'control_failure', 'confirmed_loss', 'dismissed', 'closed'],
  awaiting_information: ['investigating', 'explained', 'control_failure', 'confirmed_loss', 'dismissed', 'closed'],
  explained: ['investigating', 'closed'],
  control_failure: ['investigating', 'closed'],
  confirmed_loss: ['investigating', 'closed'],
  dismissed: ['investigating', 'closed'],
  closed: [],
};

type ActionPanel = 'assign' | 'status' | 'note' | 'link' | 'cctv' | 'reopen' | null;

interface Props {
  id: string | null;
  canManage: boolean;
  canAssign: boolean;
  canResolve: boolean;
  canCctv: boolean;
  onClose: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}

export function CaseDetail({ id, canManage, canAssign, canResolve, canCctv, onClose, onChanged, onError }: Props) {
  const t = useTranslations('posAudit');
  const locale = useLocale();
  const [row, setRow] = useState<InvestigationCaseRow | null>(null);
  const [timeline, setTimeline] = useState<CaseTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [panel, setPanel] = useState<ActionPanel>(null);
  const [submitting, setSubmitting] = useState(false);

  const [ownerId, setOwnerId] = useState('');
  const [toStatus, setToStatus] = useState<CaseStatus | ''>('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [confirmedLoss, setConfirmedLoss] = useState('');
  const [recoveredAmount, setRecoveredAmount] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [noteCategory, setNoteCategory] = useState('general');
  const [exceptionId, setExceptionId] = useState('');
  const [rationale, setRationale] = useState('');
  const [reopenReason, setReopenReason] = useState('');
  const [cctvLabel, setCctvLabel] = useState('');
  const [cctvStart, setCctvStart] = useState('');
  const [cctvEnd, setCctvEnd] = useState('');
  const [cctvRef, setCctvRef] = useState('');
  const [cctvNote, setCctvNote] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [detail, tl] = await Promise.all([
        api<{ data: InvestigationCaseRow }>(`/pos/investigations/${id}`),
        api<{ data: CaseTimeline }>(`/pos/investigations/${id}/timeline`),
      ]);
      setRow(detail.data);
      setTimeline(tl.data);
    } catch (error) {
      onError(error instanceof ApiError ? error.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [id, onError, t]);

  useEffect(() => {
    if (id) {
      void load();
      setPanel(null);
    } else {
      setRow(null);
      setTimeline(null);
    }
  }, [id, load]);

  function resetActionFields() {
    setOwnerId(''); setToStatus(''); setReason(''); setNote(''); setConfirmedLoss(''); setRecoveredAmount('');
    setNoteBody(''); setNoteCategory('general'); setExceptionId(''); setRationale(''); setReopenReason('');
    setCctvLabel(''); setCctvStart(''); setCctvEnd(''); setCctvRef(''); setCctvNote('');
  }

  function openPanel(next: ActionPanel) {
    resetActionFields();
    setPanel(panel === next ? null : next);
  }

  async function refreshAfterAction(message: string) {
    setPanel(null);
    resetActionFields();
    await load();
    onChanged();
    void message;
  }

  async function submitAssign() {
    if (!row) return;
    setSubmitting(true);
    try {
      await api(`/pos/investigations/${row.id}/assign`, { method: 'POST', body: { owner_id: ownerId || null } });
      await refreshAfterAction('assigned');
    } catch (error) { onError(error instanceof ApiError ? error.message : t('loadFailed')); }
    finally { setSubmitting(false); }
  }

  async function submitStatus() {
    if (!row || !toStatus) return;
    setSubmitting(true);
    try {
      await api(`/pos/investigations/${row.id}/status`, {
        method: 'POST',
        body: {
          status: toStatus, reason: reason || undefined, note: note || undefined,
          confirmed_loss_minor: confirmedLoss ? Math.round(Number(confirmedLoss) * 100) : undefined,
          recovered_amount_minor: recoveredAmount ? Math.round(Number(recoveredAmount) * 100) : undefined,
        },
      });
      await refreshAfterAction('status');
    } catch (error) { onError(error instanceof ApiError ? error.message : t('loadFailed')); }
    finally { setSubmitting(false); }
  }

  async function submitReopen() {
    if (!row || !reopenReason.trim()) return;
    setSubmitting(true);
    try {
      await api(`/pos/investigations/${row.id}/reopen`, { method: 'POST', body: { reason: reopenReason } });
      await refreshAfterAction('reopened');
    } catch (error) { onError(error instanceof ApiError ? error.message : t('loadFailed')); }
    finally { setSubmitting(false); }
  }

  async function submitNote() {
    if (!row || !noteBody.trim()) return;
    setSubmitting(true);
    try {
      await api(`/pos/investigations/${row.id}/notes`, { method: 'POST', body: { body: noteBody, category: noteCategory } });
      await refreshAfterAction('note');
    } catch (error) { onError(error instanceof ApiError ? error.message : t('loadFailed')); }
    finally { setSubmitting(false); }
  }

  async function submitLink() {
    if (!row || !exceptionId.trim()) return;
    setSubmitting(true);
    try {
      await api(`/pos/investigations/${row.id}/link-exception`, { method: 'POST', body: { pos_exception_id: exceptionId.trim(), rationale: rationale || undefined } });
      await refreshAfterAction('linked');
    } catch (error) { onError(error instanceof ApiError ? error.message : t('loadFailed')); }
    finally { setSubmitting(false); }
  }

  async function unlink(linkId: string) {
    if (!row) return;
    try {
      await api(`/pos/investigations/${row.id}/evidence-links/${linkId}/unlink`, { method: 'POST', body: {} });
      await load();
      onChanged();
    } catch (error) { onError(error instanceof ApiError ? error.message : t('loadFailed')); }
  }

  async function submitCctv() {
    if (!row || !cctvLabel.trim() || !cctvStart) return;
    setSubmitting(true);
    try {
      await api(`/pos/investigations/${row.id}/cctv-bookmarks`, {
        method: 'POST',
        body: {
          camera_label: cctvLabel, timestamp_start: new Date(cctvStart).toISOString(),
          timestamp_end: cctvEnd ? new Date(cctvEnd).toISOString() : undefined,
          external_reference: cctvRef || undefined, note: cctvNote || undefined,
        },
      });
      await refreshAfterAction('cctv');
    } catch (error) { onError(error instanceof ApiError ? error.message : t('loadFailed')); }
    finally { setSubmitting(false); }
  }

  async function removeCctv(bookmarkId: string) {
    if (!row) return;
    try {
      await api(`/pos/investigations/${row.id}/cctv-bookmarks/${bookmarkId}`, { method: 'DELETE' });
      await load();
      onChanged();
    } catch (error) { onError(error instanceof ApiError ? error.message : t('loadFailed')); }
  }

  const ruleLabel = (key: string) => String(t(`rules.${key}` as never, { fallback: key }));
  const activityIcon = (action: string) => {
    if (action.startsWith('cctv')) return Camera;
    if (action === 'note_added') return FileText;
    if (action === 'evidence_linked' || action === 'evidence_unlinked') return Link2;
    if (action === 'assigned' || action === 'reassigned') return UserCog;
    return ClipboardList;
  };

  return (
    <Dialog open={id !== null} onClose={onClose} title={row ? `${row.number} — ${row.title}` : t('cases.caseDetails')} className="max-w-3xl">
      {loading && !row ? (
        <p className="text-sm text-muted">{t('loading')}</p>
      ) : row ? (
        <div className="space-y-5">
          <section className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={caseStatusTone(row.status)}>{t(`cases.statuses.${row.status}` as never, { fallback: row.status })}</Badge>
              <Badge tone={casePriorityTone(row.priority)}>{t(`cases.priorities.${row.priority}` as never, { fallback: row.priority })}</Badge>
              {row.subject?.name && <span className="text-sm text-muted">{row.subject.name}</span>}
            </div>
            {row.summary && <p className="text-sm text-text">{row.summary}</p>}
            <p className="rounded border border-border bg-background p-2 text-xs text-muted">{t('notAccusation')}</p>
          </section>

          <section className="grid gap-3 rounded border border-border p-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label={t('cases.owner')} value={row.owner?.name ?? t('cases.unassigned')} />
            <Metric label={t('amountUnderReview')} value={row.amount_under_review_minor > 0 ? formatRiyal(row.amount_under_review) : '—'} mono />
            <Metric label={t('cases.confirmedLoss')} value={row.confirmed_loss ? formatRiyal(row.confirmed_loss) : '—'} mono />
            <Metric label={t('cases.recoveredAmount')} value={row.recovered_amount ? formatRiyal(row.recovered_amount) : '—'} mono />
          </section>

          {/* شريط إجراءات سريعة */}
          <section className="flex flex-wrap gap-2">
            {canAssign && <Button size="sm" variant="outline" onClick={() => openPanel('assign')}><UserCog className="h-3.5 w-3.5" strokeWidth={1.6} />{t('cases.assign')}</Button>}
            {canManage && row.status !== 'closed' && <Button size="sm" variant="outline" onClick={() => openPanel('status')}><ShieldQuestion className="h-3.5 w-3.5" strokeWidth={1.6} />{t('cases.changeStatus')}</Button>}
            {canResolve && row.status === 'closed' && <Button size="sm" variant="outline" onClick={() => openPanel('reopen')}><CalendarClock className="h-3.5 w-3.5" strokeWidth={1.6} />{t('cases.reopen')}</Button>}
            {canManage && <Button size="sm" variant="outline" onClick={() => openPanel('note')}><FileText className="h-3.5 w-3.5" strokeWidth={1.6} />{t('cases.addNote')}</Button>}
            {canManage && <Button size="sm" variant="outline" onClick={() => openPanel('link')}><Link2 className="h-3.5 w-3.5" strokeWidth={1.6} />{t('cases.linkEvidence')}</Button>}
            {canCctv && <Button size="sm" variant="outline" onClick={() => openPanel('cctv')}><Camera className="h-3.5 w-3.5" strokeWidth={1.6} />{t('cases.addCctv')}</Button>}
          </section>

          {panel === 'assign' && (
            <ActionForm onSubmit={submitAssign} submitting={submitting} submitLabel={t('cases.assign')}>
              <label className="block"><Label htmlFor="case-owner">{t('cases.ownerUserId')}</Label><Input id="case-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)} placeholder={t('cases.ownerUserIdHint')} /></label>
            </ActionForm>
          )}

          {panel === 'status' && (
            <ActionForm onSubmit={submitStatus} submitting={submitting} submitLabel={t('applyDisposition')} disabled={!toStatus}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <Label htmlFor="case-to-status">{t('newState')}</Label>
                  <Select id="case-to-status" value={toStatus} onChange={(e) => setToStatus(e.target.value as CaseStatus)}>
                    <option value="">{t('choose')}</option>
                    {NEXT_STATES[row.status].map((s) => <option key={s} value={s}>{t(`cases.statuses.${s}` as never, { fallback: s })}</option>)}
                  </Select>
                </label>
                <label>
                  <Label htmlFor="case-reason">{t('reason')}</Label>
                  <Input id="case-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={80} />
                </label>
              </div>
              {toStatus === 'confirmed_loss' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label><Label htmlFor="case-confirmed">{t('cases.confirmedLoss')}</Label><Input id="case-confirmed" className="num" inputMode="decimal" value={confirmedLoss} onChange={(e) => setConfirmedLoss(e.target.value)} /></label>
                  <label><Label htmlFor="case-recovered">{t('cases.recoveredAmount')}</Label><Input id="case-recovered" className="num" inputMode="decimal" value={recoveredAmount} onChange={(e) => setRecoveredAmount(e.target.value)} /></label>
                </div>
              )}
              <label className="block">
                <Label htmlFor="case-note">{t('note')}{toStatus && OUTCOME_STATES.includes(toStatus) ? ' *' : ''}</Label>
                <textarea id="case-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" />
              </label>
            </ActionForm>
          )}

          {panel === 'reopen' && (
            <ActionForm onSubmit={submitReopen} submitting={submitting} submitLabel={t('cases.reopen')} disabled={!reopenReason.trim()}>
              <label className="block"><Label htmlFor="case-reopen-reason">{t('reason')} *</Label><Input id="case-reopen-reason" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} maxLength={2000} /></label>
            </ActionForm>
          )}

          {panel === 'note' && (
            <ActionForm onSubmit={submitNote} submitting={submitting} submitLabel={t('cases.addNote')} disabled={!noteBody.trim()}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <Label htmlFor="case-note-category">{t('cases.noteCategory')}</Label>
                  <Select id="case-note-category" value={noteCategory} onChange={(e) => setNoteCategory(e.target.value)}>
                    {['general', 'investigation', 'evidence', 'resolution'].map((c) => <option key={c} value={c}>{t(`cases.noteCategories.${c}` as never, { fallback: c })}</option>)}
                  </Select>
                </label>
              </div>
              <label className="block"><Label htmlFor="case-note-body">{t('cases.noteBody')}</Label><textarea id="case-note-body" value={noteBody} onChange={(e) => setNoteBody(e.target.value)} maxLength={5000} rows={3} className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" /></label>
            </ActionForm>
          )}

          {panel === 'link' && (
            <ActionForm onSubmit={submitLink} submitting={submitting} submitLabel={t('cases.linkEvidence')} disabled={!exceptionId.trim()}>
              <label className="block"><Label htmlFor="case-link-exception">{t('cases.exceptionId')}</Label><Input id="case-link-exception" dir="ltr" value={exceptionId} onChange={(e) => setExceptionId(e.target.value)} /></label>
              <label className="block"><Label htmlFor="case-link-rationale">{t('cases.linkRationale')}</Label><Input id="case-link-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} maxLength={2000} /></label>
            </ActionForm>
          )}

          {panel === 'cctv' && (
            <ActionForm onSubmit={submitCctv} submitting={submitting} submitLabel={t('cases.addCctv')} disabled={!cctvLabel.trim() || !cctvStart}>
              <div className="grid gap-3 sm:grid-cols-2">
                <label><Label htmlFor="cctv-label">{t('cases.cameraLabel')}</Label><Input id="cctv-label" value={cctvLabel} onChange={(e) => setCctvLabel(e.target.value)} maxLength={120} /></label>
                <label><Label htmlFor="cctv-ref">{t('cases.cctvReference')}</Label><Input id="cctv-ref" dir="ltr" value={cctvRef} onChange={(e) => setCctvRef(e.target.value)} placeholder="https://" /></label>
                <label><Label htmlFor="cctv-start">{t('cases.cctvStart')}</Label><Input id="cctv-start" type="datetime-local" value={cctvStart} onChange={(e) => setCctvStart(e.target.value)} /></label>
                <label><Label htmlFor="cctv-end">{t('cases.cctvEnd')}</Label><Input id="cctv-end" type="datetime-local" value={cctvEnd} onChange={(e) => setCctvEnd(e.target.value)} /></label>
              </div>
              <label className="block"><Label htmlFor="cctv-note">{t('note')}</Label><Input id="cctv-note" value={cctvNote} onChange={(e) => setCctvNote(e.target.value)} maxLength={2000} /></label>
            </ActionForm>
          )}

          {row.resolution_summary || row.resolution_reason ? (
            <section className="rounded border border-border bg-background p-3">
              <h3 className="text-sm font-semibold text-text">{t('cases.resolution')}</h3>
              <p className="mt-1 text-sm text-text">{row.resolution_reason}</p>
              {row.resolution_summary && <p className="mt-1 text-sm text-muted">{row.resolution_summary}</p>}
            </section>
          ) : null}

          {/* الأدلة المرتبطة */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-text">{t('cases.linkedEvidence')}</h3>
            {timeline && timeline.evidence_links.filter((l) => !l.unlinked_at).length > 0 ? (
              <ul className="space-y-2">
                {timeline.evidence_links.filter((l) => !l.unlinked_at).map((link) => (
                  <li key={link.id} className="flex items-center justify-between gap-3 rounded border border-border p-2">
                    <div>
                      <p className="text-sm text-text">
                        {link.exception ? ruleLabel(link.exception.rule_key) : link.event ? link.event.type : t('cases.manualLink')}
                        <Badge className="ms-2" tone={link.exception?.evidence_confidence === 'server_authoritative' ? 'neutral' : 'muted'}>
                          {t(`confidence.${link.exception?.evidence_confidence ?? 'server_authoritative'}` as never, { fallback: 'server_authoritative' })}
                        </Badge>
                      </p>
                      <p className="mt-0.5 text-xs text-muted">{formatDateTime(link.linked_at, locale)}</p>
                    </div>
                    {canManage && <Button size="sm" variant="outline" onClick={() => void unlink(link.id)}>{t('cases.unlink')}</Button>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{t('cases.noEvidence')}</p>
            )}
          </section>

          {/* مراجع الكاميرا */}
          {timeline && timeline.cctv_bookmarks.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-text">{t('cases.cctvBookmarks')}</h3>
              <ul className="space-y-2">
                {timeline.cctv_bookmarks.map((bookmark) => (
                  <li key={bookmark.id} className="flex items-center justify-between gap-3 rounded border border-border p-2">
                    <div>
                      <p className="text-sm text-text">{bookmark.camera_label}</p>
                      <p className="num mt-0.5 text-xs text-muted">
                        {formatDateTime(bookmark.timestamp_start, locale)}
                        {bookmark.timestamp_end ? ` – ${formatDateTime(bookmark.timestamp_end, locale)}` : ''} · {bookmark.source_timezone}
                      </p>
                      {bookmark.external_reference && (
                        <a href={bookmark.external_reference} target="_blank" rel="noopener noreferrer" className="mt-0.5 block text-xs text-primary underline-offset-4 hover:underline">
                          {t('cases.openReference')}
                        </a>
                      )}
                    </div>
                    {canCctv && <Button size="sm" variant="outline" onClick={() => void removeCctv(bookmark.id)}>{t('cases.remove')}</Button>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* الملاحظات */}
          {timeline && timeline.notes.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-text">{t('cases.notes')}</h3>
              <ul className="space-y-2">
                {timeline.notes.map((n) => (
                  <li key={n.id} className="rounded border border-border p-2">
                    <p className="text-sm text-text">{n.body}</p>
                    <p className="mt-1 text-xs text-muted">{n.author_name ?? '—'} · {formatDateTime(n.created_at, locale)} · {t(`cases.noteCategories.${n.category}` as never, { fallback: n.category })}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* سجل النشاط */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-text">{t('cases.activityLog')}</h3>
            {timeline && timeline.activities.length > 0 ? (
              <ol className="space-y-0 border-s border-border">
                {timeline.activities.map((activity) => {
                  const Icon = activityIcon(activity.action);
                  return (
                    <li key={activity.id} className="relative ps-4 pb-3">
                      <span className="absolute -start-1.5 top-1.5 h-3 w-3 rounded-full border-2 border-surface bg-primary" aria-hidden="true" />
                      <p className="flex items-center gap-1.5 text-sm text-text">
                        <Icon className="h-3.5 w-3.5 text-muted" strokeWidth={1.6} />
                        {t(`cases.activities.${activity.action}` as never, { fallback: activity.action })}
                        {activity.actor_name ? ` · ${activity.actor_name}` : ''}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">{formatDateTime(activity.created_at, locale)}{activity.note ? ` · ${activity.note}` : ''}</p>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-sm text-muted">—</p>
            )}
          </section>
        </div>
      ) : null}
    </Dialog>
  );
}

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-sm text-text ${mono ? 'num' : ''}`}>{value}</p>
    </div>
  );
}

function ActionForm({
  children, onSubmit, submitting, submitLabel, disabled,
}: {
  children: React.ReactNode;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
  disabled?: boolean;
}) {
  const t = useTranslations('posAudit');
  return (
    <section className="space-y-3 rounded border border-border bg-background p-3">
      {children}
      <div className="flex justify-end gap-2">
        <Button onClick={() => void onSubmit()} disabled={submitting || disabled}>
          {submitting ? t('saving') : submitLabel}
        </Button>
      </div>
    </section>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { apiErrorMessage } from './product-preview';
import { currentLang } from './product-execution';
import { ENABLEMENT_TEXT, executionBlockReason, fetchEnablement, saveEnablement, saveExecutionApproval, type Enablement } from './enablement';

/**
 * بطاقة قبول المؤسسة لـAI Actions. التبديل لمن يملك `ai.actions.manage` فقط (الخادم يفرضها)؛ التفعيل معطَّل
 * ما دامت المنصة مطفأة (الخادم يرفضه 409)، والإيقاف متاح دائماً.
 */
export function AiActionsEnablementCard({ canManage, isOwner = false }: { canManage: boolean; isOwner?: boolean }) {
  const text = ENABLEMENT_TEXT[currentLang()];
  const { success, error } = useToast();
  const [state, setState] = useState<Enablement | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await fetchEnablement());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function change(next: boolean) {
    if (saving) return;
    setSaving(true);
    try {
      setState(await saveEnablement(next));
      success(text.saved);
    } catch (exception) {
      error(exception instanceof ApiError ? apiErrorMessage(exception.body, text.failed) : text.failed);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function changeApproval(next: boolean) {
    if (saving) return;
    setSaving(true);
    try {
      setState(await saveExecutionApproval(next));
      success(text.saved);
    } catch (exception) {
      error(exception instanceof ApiError ? apiErrorMessage(exception.body, text.failed) : text.failed);
      await load();
    } finally {
      setSaving(false);
    }
  }

  const blockReason = state ? executionBlockReason(state) : null;

  return (
    <Card data-testid="ai-actions-enablement">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {text.title}
          {state ? <Badge tone={state.tenant_enabled ? 'positive' : 'muted'}>{state.tenant_enabled ? text.on : text.off}</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm leading-relaxed text-muted">{text.hint}</p>
        {failed ? <p role="alert" className="text-sm text-negative">{text.loadFailed}</p> : null}
        {state && state.reason === 'platform_disabled' ? <p role="status" className="text-sm text-warning">{text.platformOff}</p> : null}
        {state && canManage ? (
          <label className="flex items-center gap-3 text-sm text-text">
            <Switch
              aria-label={text.toggle}
              checked={state.tenant_enabled}
              disabled={saving || (!state.tenant_enabled && !state.platform_enabled)}
              onCheckedChange={(next) => void change(next)}
            />
            {text.toggle}
          </label>
        ) : null}
        {state && state.tenant_enabled ? (
          <section aria-label={text.approvalTitle} data-testid="ai-actions-execution-approval" className="space-y-2 border-t border-border pt-3">
            <h3 className="text-sm font-medium text-text">{text.approvalTitle}</h3>
            <p className="text-sm leading-relaxed text-muted">{text.approvalHint}</p>
            {isOwner ? (
              <label className="flex items-center gap-3 text-sm text-text">
                <Switch aria-label={text.approvalToggle} checked={state.execution_approved === true} disabled={saving} onCheckedChange={(next) => void changeApproval(next)} />
                {text.approvalToggle}
              </label>
            ) : (
              <p className="text-sm text-muted">{state.execution_approved ? text.on : text.off} · {text.approvalOwnerOnly}</p>
            )}
            {state.controls_enforced && blockReason ? (
              <p role="status" data-testid="ai-actions-execution-reason" className="text-sm text-warning">{text.executionReasons[blockReason] ?? blockReason}</p>
            ) : null}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * إشعار على شاشات AI Actions حين لا تكون فعّالة: يشرح السبب (المنصة أو المؤسسة) ويحيل إلى الإعدادات لمن يملك الصلاحية.
 * لا يظهر حين تكون فعّالة، ولا يظهر إن تعذّر جلب الحالة (الخادم يرفض الطلبات الفعلية على أي حال).
 */
export function AiActionsDisabledNotice({ canManage, settingsHref = '/intelligence/settings' }: { canManage: boolean; settingsHref?: string }) {
  const text = ENABLEMENT_TEXT[currentLang()];
  const [state, setState] = useState<Enablement | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchEnablement().then((next) => { if (!cancelled) setState(next); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  if (!state || state.effective || state.reason === 'enabled') return null;
  return (
    <p role="status" data-testid="ai-actions-disabled-notice" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-text">
      {text.reasons[state.reason]}{' '}
      {state.reason === 'tenant_not_enabled'
        ? canManage
          ? <a className="font-medium text-primary underline" href={settingsHref}>{text.toggle}</a>
          : text.askOwner
        : null}
    </p>
  );
}

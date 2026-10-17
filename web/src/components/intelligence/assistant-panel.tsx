'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Building2, ChevronLeft, FileSpreadsheet, Info, LayoutPanelTop, MapPin, Send, Settings2, Sparkles, Trash2, Users, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/use-can';
import { MESSAGE_MAX_CHARS, toolKey, type ToolName } from '@/modules/intelligence/contract';
import { resolveAssistantContext } from '@/modules/intelligence/context';
import { gateFor } from '@/modules/intelligence/gate';
import { useIntelligence, type ChatEntry } from '@/modules/intelligence/store';
import { ResultSummary } from './result-summary';
import { StateNotice } from './state-notice';

function Entry({ entry, onOpenCanvas, onNavigate, runIds, demo }: {
  entry: ChatEntry;
  onOpenCanvas: (runId: string) => void;
  onNavigate: () => void;
  runIds: Set<string>;
  demo: boolean;
}) {
  const t = useTranslations('intelligence');
  if (entry.role === 'notice' && entry.error) {
    return <StateNotice notice={entry.error.notice} code={entry.error.code} compact onNavigate={onNavigate} />;
  }
  if (entry.role === 'user') {
    return (
      <div className="awj-intel-rise flex flex-col items-end gap-0.5" data-role="user">
        <p className="px-1 text-[11px] text-muted">{t('panel.you')}</p>
        <p dir="auto" className="max-w-[90%] whitespace-pre-wrap break-words rounded-lg rounded-ee-sm bg-primary-soft px-3 py-2 text-sm text-text">{entry.text}</p>
      </div>
    );
  }
  return (
    <div className="awj-intel-rise flex gap-2" data-role="assistant">
      <span aria-hidden="true" className="mt-5 flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary-soft text-primary">
        <Sparkles className="h-4 w-4" strokeWidth={1.7} />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <div className="mb-0.5 flex items-center gap-2 px-1 text-[11px] text-muted">
            <span>{t('panel.assistant')}</span>
            {demo ? <Badge tone="warning">{t('demo.badge')}</Badge> : null}
          </div>
          <div className="rounded-lg rounded-ss-sm border border-border bg-surface px-3 py-2 text-sm">
            <p dir="auto" className="whitespace-pre-wrap break-words">{entry.text}</p>
            {demo ? <p className="mt-1.5 border-t border-border pt-1.5 text-xs text-muted">{t('demo.reply')}</p> : null}
          </div>
        </div>
        {entry.toolCalls && entry.toolCalls.length > 0
          ? entry.toolCalls.map((call, index) => {
            const runId = entry.runIds?.[index];
            return (
              <ResultSummary
                key={`${entry.id}-${index}`}
                call={call}
                canOpenCanvas={Boolean(runId && runIds.has(runId))}
                onOpenCanvas={() => runId && onOpenCanvas(runId)}
                onNavigate={onNavigate}
              />
            );
          })
          : <p className="px-1 text-xs text-muted">{t('panel.no_tool')}</p>}
      </div>
    </div>
  );
}

const TOOL_ORDER: ToolName[] = ['finance.income_statement', 'finance.receivables_aging', 'finance.payables_aging'];

const TOOL_ICON: Record<ToolName, LucideIcon> = {
  'finance.income_statement': FileSpreadsheet,
  'finance.receivables_aging': Users,
  'finance.payables_aging': Building2,
};

function Suggestion({ tool, onPick, primary }: { tool: ToolName; onPick: (tool: ToolName) => void; primary: boolean }) {
  const t = useTranslations('intelligence');
  const Icon = TOOL_ICON[tool];
  return (
    <Button
      type="button"
      variant="outline"
      className={`h-11 w-full justify-start gap-3 px-3 sm:h-10 ${primary ? '' : 'text-muted'}`}
      onClick={() => onPick(tool)}
    >
      <Icon className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-start">{t(`panel.quick.${toolKey(tool)}`)}</span>
      <ChevronLeft className="h-4 w-4 shrink-0 text-muted ltr:rotate-180" strokeWidth={1.7} aria-hidden="true" />
    </Button>
  );
}

/**
 * لوحة المساعد السياقي: Sheet على الجانب المنطقي (يمين في RTL)، وبملء الشاشة على الجوال مع زر رجوع.
 * لا تقرأ DOM الصفحة ولا ترسل سياقها: السياق عنوان وترتيب اقتراحات فقط.
 */
export function AssistantPanel() {
  const t = useTranslations('intelligence');
  const store = useIntelligence();
  const router = useRouter();
  const pathname = usePathname();
  const { can } = useCan();
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  // العنصر الذي فتح اللوحة: يستعيد الإغلاقُ التركيزَ إليه (الـSheet مضبوط الحالة بلا Trigger فلا يفعلها Radix وحده).
  const openerRef = useRef<HTMLElement | null>(null);

  const context = useMemo(() => resolveAssistantContext(pathname), [pathname]);
  const gate = gateFor(store, 'chat');
  const canManage = store.status?.abilities.manage_consent === true;
  const demo = store.status?.provider_mode === 'mock';
  const runIds = useMemo(() => new Set(store.runs.map((run) => run.id)), [store.runs]);
  const tooLong = draft.length > MESSAGE_MAX_CHARS;
  const canSend = gate.kind === 'ready' && !store.chatPending && draft.trim().length > 0 && !tooLong;

  // التركيز على مربع الكتابة عند فتح اللوحة: يُؤجَّل إلى أن تصير الحالة جاهزة لأن المربع معطّل قبل ذلك (ولا يُفعَل على اللمس).
  const focusPending = useRef(false);
  useEffect(() => {
    if (!store.panelOpen) { focusPending.current = true; return; }
    if (focusPending.current && gate.kind === 'ready') {
      focusPending.current = false;
      const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
      if (!coarse) textareaRef.current?.focus();
    }
  }, [store.panelOpen, gate.kind]);

  // آخر رسالة داخل نطاق الرؤية عند ورود ردّ جديد.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [store.entries.length, store.chatPending]);

  function submit() {
    if (!canSend) return;
    const text = draft;
    setDraft('');
    void store.send(text);
  }

  function suggest(tool: ToolName) {
    if (gate.kind !== 'ready' || store.chatPending) return;
    void store.send(t(`panel.quick_message.${toolKey(tool)}`));
  }

  function openCanvas(runId?: string) {
    if (runId) store.setActiveRunId(runId);
    store.closePanel();
    router.push('/intelligence');
  }

  return (
    <Sheet open={store.panelOpen} onOpenChange={(open) => (open ? store.openPanel() : store.closePanel())}>
      <SheetContent
        closeLabel={t('panel.close')}
        // على الجوال زر «رجوع» بدل X المقتطع في الزاوية؛ على الشاشات الأوسع يبقى X.
        className="max-sm:[&>button]:hidden sm:max-w-md"
        data-awj-assistant-panel=""
        onOpenAutoFocus={(event) => {
          openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          // الحالة معروفة مسبقاً (فتحٌ ثانٍ): ركّز مربع الكتابة مباشرة. وإلا يتولّى التأثير أعلاه ذلك حين تصير جاهزة.
          const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
          const box = textareaRef.current;
          if (!coarse && box && !box.disabled) {
            event.preventDefault();
            box.focus();
            focusPending.current = false;
          }
        }}
        onCloseAutoFocus={(event) => {
          const opener = openerRef.current;
          openerRef.current = null;
          // يتجاهل عنصراً لم يعد مرئياً (قائمة الحساب على الجوال أُغلقت) فيعمل الافتراضي.
          if (opener && opener.isConnected && !opener.closest('[aria-hidden="true"], [hidden]')) {
            event.preventDefault();
            opener.focus();
          }
        }}
      >
        <header className="shrink-0 space-y-2.5 border-b border-border px-4 pb-3 pt-3 pe-14 max-sm:pe-4">
          <div className="flex items-center gap-2.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0 sm:hidden"
              aria-label={t('panel.back')}
              onClick={store.closePanel}
            >
              <ArrowRight className="h-5 w-5 ltr:rotate-180" strokeWidth={1.7} aria-hidden="true" />
            </Button>
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-primary text-primary-foreground">
              <Sparkles className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </span>
            <div className="min-w-0 flex-1">
              <SheetTitle className="flex items-center gap-2 text-base font-semibold leading-tight text-text">
                {t('panel.title')}
                {demo ? <Badge tone="warning">{t('demo.badge')}</Badge> : null}
              </SheetTitle>
              <SheetDescription className="mt-0.5 text-xs leading-snug text-muted">{t('panel.description')}</SheetDescription>
            </div>
            {store.entries.length > 0 ? (
              <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 sm:h-9 sm:w-9" aria-label={t('panel.clear')} onClick={store.clearConversation}>
                <Trash2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted" title={t('panel.context_note')}>
            <MapPin className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
            <span>{t('panel.context_label')}:</span>
            <Badge tone="muted" data-context={context.kind}>
              {t(`context.${context.kind}`)}
              {context.entityId ? <span dir="ltr" className="font-mono">…{context.entityId.slice(-6)}</span> : null}
            </Badge>
          </div>
        </header>

        <div ref={logRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" role="log" aria-live="polite" aria-label={t('panel.title')}>
          {gate.kind === 'loading' ? (
            <div role="status" aria-busy="true" aria-label={t('panel.loading_status')} className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
            </div>
          ) : null}
          {gate.kind === 'error' ? (
            <StateNotice notice={gate.error.notice} code={gate.error.code} compact onRetry={() => void store.refreshStatus()} />
          ) : null}
          {gate.kind === 'blocked' ? (
            <StateNotice notice={gate.notice} compact canManageConsent={canManage} onNavigate={store.closePanel} />
          ) : null}
          {gate.kind === 'ready' && store.entries.length === 0 ? (
            <div className="awj-intel-rise space-y-4">
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="text-sm font-semibold text-text">{t('panel.empty_title')}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{t('panel.empty_body')}</p>
              </div>
              <div role="group" aria-label={t('panel.suggestions')} className="space-y-2">
                {/* اقتراحات هذه الشاشة أولاً (ترتيب فقط — لا تشغيل تلقائي)؛ كل اقتراح يُرسل سؤالاً جاهزاً عبر البوابة. */}
                <p className="px-1 text-xs font-medium text-muted">{context.kind === 'other' || context.kind === 'dashboard' || context.kind === 'reports' || context.kind === 'intelligence' ? t('panel.suggestions') : t('panel.suggestions_for_screen')}</p>
                {context.suggestedTools.map((tool) => (
                  <Suggestion key={tool} tool={tool} primary onPick={suggest} />
                ))}
                {context.suggestedTools.length < 3 ? (
                  <>
                    <p className="px-1 pt-1 text-xs font-medium text-muted">{t('panel.more_reports')}</p>
                    {TOOL_ORDER.filter((tool) => !context.suggestedTools.includes(tool)).map((tool) => (
                      <Suggestion key={tool} tool={tool} primary={false} onPick={suggest} />
                    ))}
                  </>
                ) : null}
              </div>
              <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-muted">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.7} aria-hidden="true" />
                {t('panel.not_yet')}
              </p>
            </div>
          ) : null}
          {store.entries.map((entry) => (
            <Entry key={entry.id} entry={entry} runIds={runIds} demo={demo} onOpenCanvas={openCanvas} onNavigate={store.closePanel} />
          ))}
          {store.chatPending ? (
            <p role="status" className="text-xs text-muted">{t('panel.pending')}</p>
          ) : null}
        </div>

        <footer className="shrink-0 space-y-2 border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="flex items-end gap-2 rounded-lg border border-border bg-background p-1.5 focus-within:ring-2 focus-within:ring-primary/40">
            <textarea
              ref={textareaRef}
              value={draft}
              rows={2}
              disabled={gate.kind !== 'ready'}
              aria-label={t('panel.placeholder')}
              placeholder={t('panel.placeholder')}
              aria-invalid={tooLong || undefined}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }}
              className="min-h-[3.25rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-text placeholder:text-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
            <Button type="button" className="h-11 w-11 shrink-0 px-0 sm:h-9 sm:w-9" aria-label={t('panel.send')} disabled={!canSend} onClick={submit}>
              <Send className="h-4 w-4 rtl:-scale-x-100" strokeWidth={1.7} aria-hidden="true" />
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
            <span className={tooLong ? 'text-negative' : undefined}>
              {tooLong ? t('panel.too_long', { max: MESSAGE_MAX_CHARS }) : t('panel.hint')}
            </span>
            <span dir="ltr" className="num shrink-0">{t('panel.counter', { count: draft.length, max: MESSAGE_MAX_CHARS })}</span>
            <span className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => openCanvas()}>
                <LayoutPanelTop className="h-3.5 w-3.5 rtl:-scale-x-100" strokeWidth={1.7} aria-hidden="true" />
                {t('panel.open_canvas_empty')}
              </Button>
              {canManage || can('ai.consent.manage') ? (
                <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => { store.closePanel(); router.push('/intelligence/settings'); }}>
                  <Settings2 className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                  {t('panel.open_settings')}
                </Button>
              ) : null}
            </span>
          </div>
        </footer>
      </SheetContent>
    </Sheet>
  );
}

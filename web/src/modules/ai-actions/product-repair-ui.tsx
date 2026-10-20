'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { currentLang } from './product-execution';
import { apiErrorMessage } from './product-preview';
import { type RepairInfo, type RepairPlan, repairHref, repairText } from './product-repair';
import { fieldLabel } from './product-preview';

/** مدخل الإصلاح تحت نتائج تنفيذ فيه فشل: يقترح الإصلاح فقط لما لا تعالجه إعادة المحاولة. */
export function RepairEntry({ actionId, executionId, refreshKey }: { actionId: string; executionId: string; refreshKey: string }) {
  const text = repairText(currentLang());
  const router = useRouter();
  const confirm = useConfirm();
  const { error } = useToast();
  const [plan, setPlan] = useState<RepairPlan | null>(null);
  const [busy, setBusy] = useState(false);
  // يمنع نقرتين متتاليتين قبل إعادة الرسم؛ الخادم يمنع التكرار الفعلي بكل حال.
  const working = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void api<{ data: RepairPlan }>(`/ai-actions/${actionId}/executions/${executionId}/repair`)
      .then((result) => { if (!cancelled) setPlan(result.data); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [actionId, executionId, refreshKey]);

  if (plan === null) return null;
  if (plan.open_repair) {
    return <Button asChild variant="outline"><Link href={repairHref(plan.open_repair.action_id)}><Wrench className="h-4 w-4" aria-hidden /> {text.resume}</Link></Button>;
  }
  if (plan.rows.length === 0) {
    return plan.retry_pending > 0 ? <p className="text-xs text-muted" data-testid="repair-retry-first">{text.retryFirst}</p> : null;
  }

  async function start() {
    if (working.current || plan === null) return;
    const ok = await confirm({ title: text.confirmTitle, message: text.confirm(plan.rows.length), confirmLabel: text.confirmLabel });
    if (!ok || working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const result = await api<{ data: { action_id: string } }>(`/ai-actions/${actionId}/executions/${executionId}/repairs`, {
        method: 'POST',
        headers: { 'Idempotency-Key': `ai-repair-${crypto.randomUUID()}` },
      });
      router.push(repairHref(result.data.action_id));
    } catch (exception) {
      error(apiErrorMessage(exception instanceof ApiError ? exception.body : null, text.failed));
      working.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1" data-testid="repair-entry">
      <p className="flex items-center gap-1.5 text-sm"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> {text.summary(plan.rows.length)}</p>
      <Button onClick={() => void start()} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Wrench className="h-4 w-4" aria-hidden />} {busy ? text.working : text.button}
      </Button>
    </div>
  );
}

/** لافتة صفحة المراجعة حين تكون العملية إصلاحاً: المصدر، وسبب فشل كل صف، وما يمكن تعديله فيه. */
export function RepairBanner({ repair }: { repair: RepairInfo }) {
  const text = repairText(currentLang());

  return (
    <section className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm" data-testid="repair-banner" aria-label={text.bannerTitle}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium"><Wrench className="h-4 w-4" aria-hidden /> {text.bannerTitle}</h2>
        <Link className="text-primary underline" href={repairHref(repair.origin.action_id)}>{text.origin}</Link>
      </div>
      <p className="text-muted">{text.bannerBody}</p>
      <ul className="space-y-2">
        {repair.rows.map((row) => (
          <li key={row.row_id} className="rounded border border-border bg-surface p-2">
            <p className="font-medium"><bdi dir="auto">{row.display?.name ?? row.display?.sku ?? row.row_id}</bdi> <span className="num text-xs text-muted">#{row.source_row}</span></p>
            <p className="text-negative">{text.why}: {row.failure.message || row.failure.code}</p>
            {row.kind === 'images' && <p className="text-xs text-muted">{text.imagesKind}</p>}
            {row.affected_fields.length > 0
              ? <p className="text-xs">{text.editable}: {row.affected_fields.map((field) => fieldLabel(field)).join(currentLang() === 'ar' ? '، ' : ', ')}</p>
              : <p className="text-xs text-muted">{text.noneEditable}</p>}
            {row.scope === 'all' && <p className="text-xs text-muted">{text.scopeAll}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

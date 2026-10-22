'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Loader2, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ImportJob } from './client';

/**
 * خطوة «إصلاح الصفوف الفاشلة» (IMP-H1-S8c) — مشتركة بين كل مجالٍ وحدته الصفّ (يُنتج الخادم وحداتٍ فاشلة لها وحدها). لا حالة موازية: تظهر فقط
 * حين تعلن التشغيلة الفاشلة `failed_units > 0`، وتنزّل الملف وترفع المصحَّح؛ والخادم هو من يتحقق من العضوية ويطالب بالوحدات.
 */
export function ImportRepairPanel({
  job,
  busy,
  onDownload,
  onRepair,
}: {
  job: ImportJob;
  busy: boolean;
  onDownload: () => void;
  onRepair: (file: File) => void;
}) {
  const t = useTranslations('importJobs');
  const input = useRef<HTMLInputElement>(null);
  const failed = job.failed_units ?? 0;

  if (job.status !== 'failed' || failed <= 0) return null;

  return (
    <section aria-labelledby="repair-title" className="space-y-3 rounded-md border border-border bg-background p-3">
      <h3 id="repair-title" className="flex items-center gap-2 text-sm font-semibold">
        <Wrench className="h-4 w-4" strokeWidth={1.7} />
        {t('repair_title')}
      </h3>
      <p className="text-sm text-muted">{t('repair_hint', { count: failed })}</p>
      <ol className="list-decimal space-y-1 ps-5 text-sm text-muted">
        <li>{t('repair_step_download')}</li>
        <li>{t('repair_step_fix')}</li>
        <li>{t('repair_step_upload')}</li>
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onDownload}>
          <Download className="h-3.5 w-3.5" strokeWidth={1.7} />
          {t('repair_download')}
        </Button>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.csv"
          className="sr-only"
          aria-label={t('repair_upload')}
          data-testid="repair-file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onRepair(file);
          }}
        />
        <Button type="button" size="sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.7} /> : <Wrench className="h-3.5 w-3.5" strokeWidth={1.7} />}
          {t('repair_upload')}
        </Button>
      </div>
      <p className="text-xs text-muted">{t('repair_protected_note')}</p>
    </section>
  );
}

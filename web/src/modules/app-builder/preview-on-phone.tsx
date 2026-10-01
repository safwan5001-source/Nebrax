'use client';

import * as React from 'react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import { QrCode, Copy, RefreshCw, Clock } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

type ExchangeReference = { reference: string; deep_link: string; expires_at: string; exchange_reference_id: string };
type QrPhase = 'idle' | 'creating' | 'ready' | 'expired' | 'consumed' | 'error';

/**
 * APP-BUILDER-PREVIEW-UX-1 — «معاينة على الجوال» مستخرجة حرفياً من تدفّق الـQR الذي
 * بنته MOBILE-PREVIEW-7 في صفحة تفاصيل التطبيق (`app-builder/[id]/page.tsx`) إلى مكوّن
 * قابل لإعادة الاستخدام، فيظهر نفس الزر وتدفّق التبادل نفسه حرفياً من شريط أدوات
 * المعاينة داخل مساحة التحرير (`builder/page.tsx`) أيضاً — **بلا بروتوكول ثانٍ**، نفس
 * `POST .../preview-exchange-references` + QR لرابط التبادل + عدّاد الانتهاء محلياً.
 *
 * كل مثيل مستقلّ تماماً: يجلب أساس عدد جلسات المعاينة الخاص به عند فتح الحوار
 * ويستطلعه بنفسه (بدل الاعتماد على حالة قائمة جلسات مشتركة مع صفحة أخرى) — فلا تعارض
 * بين عرضَين لهذا المكوّن (صفحة التفاصيل ومساحة التحرير) لنفس التطبيق في آنٍ واحد.
 *
 * هذا الزر = «الزمن الحقيقي على جهاز فعلي» (مستوى الثقة ٤ في قرار الواجهة المعتمَد)،
 * ومتعمَّد اختلافه عن «تحديث المعاينة» (`refreshPreview` في `builder/page.tsx`) الذي
 * يُعيد مزامنة إطار المتصفح نفسه داخل مساحة التحرير (مستوى الثقة ٢) — لا يُدمَج
 * معناهما أبداً.
 */
export function PreviewOnPhoneButton({
  appId,
  variant = 'outline',
  size = 'sm',
  className,
}: {
  appId: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
}) {
  const tp = useTranslations('appBuilder.detail.previewSessions');
  const tc = useTranslations('common');
  const toast = useToast();

  const [qrOpen, setQrOpen] = useState(false);
  const [qrPhase, setQrPhase] = useState<QrPhase>('idle');
  const [qrData, setQrData] = useState<ExchangeReference | null>(null);
  const [qrRemainingSeconds, setQrRemainingSeconds] = useState(0);
  const [qrBaselineCount, setQrBaselineCount] = useState(0);
  const [qrCopied, setQrCopied] = useState(false);

  // عدّاد الانتهاء (٥ دقائق) — محلّي بالكامل، لا يمدَّد أبداً.
  useEffect(() => {
    if (qrPhase !== 'ready' || !qrData) return;
    const tick = () => {
      const remaining = Math.max(0, Math.floor((new Date(qrData.expires_at).getTime() - Date.now()) / 1000));
      setQrRemainingSeconds(remaining);
      if (remaining <= 0) setQrPhase('expired');
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [qrPhase, qrData]);

  // رصد «تم الاتصال» أفضل-جهدٍ: استطلاع قائمة جلسات المعاينة الخاصّة بهذا التطبيق —
  // لا مسار API جديد لغرضه وحده (لا ربط مباشر بين مرجعٍ بعينه وجلسته الناتجة في عقد
  // `PreviewSessionResource` اليوم). هذا الاستطلاع خاصّ بهذا المثيّل وحده.
  useEffect(() => {
    if (qrPhase !== 'ready') return;
    const id = window.setInterval(() => {
      api<{ data: unknown[] }>(`/app-builder/apps/${appId}/preview-sessions`)
        .then((res) => {
          if (res.data.length > qrBaselineCount) setQrPhase('consumed');
        })
        .catch(() => {
          // استطلاع أفضل-جهدٍ فقط — فشله لا يعطّل حوار الـQR نفسه.
        });
    }, 4000);
    return () => window.clearInterval(id);
  }, [qrPhase, appId, qrBaselineCount]);

  async function createExchangeReference() {
    setQrPhase('creating');
    try {
      const [res, baseline] = await Promise.all([
        api<ExchangeReference>(`/app-builder/apps/${appId}/preview-exchange-references`, { method: 'POST', body: {} }),
        api<{ data: unknown[] }>(`/app-builder/apps/${appId}/preview-sessions`).catch(() => ({ data: [] as unknown[] })),
      ]);
      setQrData(res);
      setQrBaselineCount(baseline.data.length);
      setQrPhase('ready');
    } catch (err) {
      setQrPhase('error');
      toast.error(tp('qrErrorTitle'), err instanceof ApiError ? err.message : undefined);
    }
  }

  function openQrDialog() {
    setQrOpen(true);
    setQrData(null);
    void createExchangeReference();
  }

  function closeQrDialog() {
    setQrOpen(false);
    setQrPhase('idle');
    setQrData(null);
  }

  async function copyDeepLink() {
    if (!qrData) return;
    try {
      await navigator.clipboard.writeText(qrData.deep_link);
      setQrCopied(true);
      window.setTimeout(() => setQrCopied(false), 1800);
    } catch {
      // الحافظة قد تُرفض في سياق غير آمن — يبقى الرابط قابلاً للنسخ يدوياً من QR.
    }
  }

  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={openQrDialog}>
        <QrCode className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
        {tp('qrAction')}
      </Button>

      <Dialog open={qrOpen} onClose={() => (qrPhase === 'creating' ? undefined : closeQrDialog())} title={tp('qrDialogTitle')}>
        <div className="space-y-4">
          {qrPhase === 'creating' && <p className="py-6 text-center text-sm text-muted">{tp('qrCreating')}</p>}

          {qrPhase === 'error' && (
            <div className="space-y-3">
              <p className="text-sm text-negative">{tp('qrErrorBody')}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void createExchangeReference()}>
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                {tp('qrRetry')}
              </Button>
            </div>
          )}

          {(qrPhase === 'ready' || qrPhase === 'expired' || qrPhase === 'consumed') && qrData && (
            <div className="space-y-4">
              <p className="text-sm leading-6 text-text">{tp('qrInstructions')}</p>

              <div className="flex justify-center">
                <div
                  className={cn(
                    'rounded-lg border p-3',
                    qrPhase === 'ready' ? 'border-border' : 'border-border opacity-30 grayscale',
                  )}
                >
                  <QRCodeSVG value={qrData.deep_link} size={196} />
                </div>
              </div>

              {qrPhase === 'ready' && (
                <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
                  <Clock className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                  {tp('qrExpiresIn', { seconds: qrRemainingSeconds })}
                </p>
              )}
              {qrPhase === 'expired' && (
                <p className="text-center text-sm font-medium text-warning">{tp('qrExpired')}</p>
              )}
              {qrPhase === 'consumed' && (
                <p className="text-center text-sm font-medium text-positive">{tp('qrConsumed')}</p>
              )}

              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={qrPhase !== 'ready'}
                  onClick={() => void copyDeepLink()}
                >
                  <Copy className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                  {qrCopied ? tp('qrCopied') : tp('qrCopyLink')}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void createExchangeReference()}>
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                  {tp('qrRegenerate')}
                </Button>
              </div>

              <p className="text-center text-xs text-muted">{tp('qrTemporaryNote')}</p>
            </div>
          )}

          <div className="flex justify-end">
            <Button variant="outline" onClick={closeQrDialog}>{tc('cancel')}</Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

'use client';

import { useState } from 'react';
import { AlertTriangle, Check, Copy, Eye, EyeOff } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** نصوص الحوار المحايد: تُمرَّر كاملةً فلا يرتبط المكوّن بمساحة ترجمة. */
export interface SecretRevealLabels {
  warning: string;
  copied: string;
  /** نصّ مربّع التأكيد وزرّ الإغلاق («حفظتُ السرّ»). */
  confirm: string;
  confirmHint: string;
  reveal: string;
  hide: string;
  copy: string;
}

/**
 * عرض السرّ **لمرّة واحدة** (مفتاح API أو سرّ توقيع) — سطح أمنيّ حرِج (§9/§29). محايد (INT-UX-5a):
 * النصوص خاصيةٌ `labels` لا مساحة ترجمة؛ `components/developer/secret-reveal` غلاف يمرّر `developer.secret`.
 *
 * ضمانات صارمة:
 *  • السرّ يعيش في حالة React لحظياً فقط؛ **لا يُكتب** إلى localStorage/sessionStorage
 *    ولا يُسجَّل ولا يُرسَل لأي تحليلات. المستدعي يمسحه من حالته عند الإغلاق فلا يُعرَض ثانيةً.
 *  • مقنّع افتراضياً (منعاً للنظر العابر) مع كشفٍ اختياري؛ والنسخ يعمل من القيمة مباشرة.
 *  • تأكيد صريح «حفظتُ السرّ» قبل تمكين الإغلاق — فلا يُفقد بإغلاقٍ عارض.
 *  • تحذير لا لبس فيه بأنه لن يُعرَض مجدداً.
 *  • `requireConfirmToClose` (اختياري، الافتراضي `false` = السلوك القديم حرفياً): حين يُفعَّل لا يُغلق الحوار
 *    بـEscape ولا بالنقر خارجه ولا بزرّ الإغلاق العلوي قبل تأكيد «حفظتُ السرّ»، وتظهر عندها رسالة التلميح.
 *    للأسرار التي يضيع معها كل شيء إن أُغلقت بالخطأ (نقطة الاستقبال الموقّعة).
 */
export function SecretRevealDialog({
  open,
  onClose,
  title,
  secret,
  description,
  labels: t,
  requireConfirmToClose = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  secret: string;
  description?: string;
  labels: SecretRevealLabels;
  requireConfirmToClose?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const [dismissBlocked, setDismissBlocked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // الحافظة قد تُرفض في سياق غير آمن — يبقى النصّ قابلاً للتحديد يدوياً.
    }
  }

  function close() {
    // إعادة الحالة الداخلية كي لا يُكشف السرّ التالي أو يبقى «منسوخاً» زوراً.
    setRevealed(false);
    setCopied(false);
    setConfirmed(false);
    setDismissBlocked(false);
    onClose();
  }

  // Escape / النقر خارج الحوار / زرّ الإغلاق العلوي: مقفلة قبل التأكيد حين يُطلب القفل (التلميح يظهر).
  function dismiss() {
    if (requireConfirmToClose && !confirmed) {
      setDismissBlocked(true);
      return;
    }
    close();
  }

  // قبل التأكيد مع القفل: زرّ X لا يغلق شيئاً فيُخفى بدل أن يوهم بعطل (يبقى Escape/الخلفية بالتلميح).
  return (
    <Dialog open={open} onClose={dismiss} title={title} hideClose={requireConfirmToClose && !confirmed}>
      <div className="space-y-4">
        {/* تحذير لا لبس فيه بنبرة تنبيه — لا لون وحده (أيقونة + نصّ). */}
        <div className="flex items-start gap-2.5 rounded border border-warning/40 bg-warning/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.8} aria-hidden="true" />
          <p className="text-sm leading-relaxed text-text">{t.warning}</p>
        </div>

        {description ? <p className="text-sm text-muted">{description}</p> : null}

        {/* صندوق السرّ: LTR + Mono + قابل للتحديد، مقنّع افتراضياً. */}
        <div className="flex items-stretch gap-2">
          <code
            dir="ltr"
            className={cn(
              'min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap rounded border border-border bg-background px-3 py-2.5 font-mono text-sm text-text',
              !revealed && 'select-none',
            )}
            aria-label={title}
          >
            {revealed ? secret : '•'.repeat(Math.min(44, Math.max(24, secret.length)))}
          </code>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setRevealed((value) => !value)}
            aria-label={revealed ? t.hide : t.reveal}
            title={revealed ? t.hide : t.reveal}
          >
            {revealed ? <EyeOff className="h-4 w-4" strokeWidth={1.7} /> : <Eye className="h-4 w-4" strokeWidth={1.7} />}
          </Button>
        </div>

        <Button type="button" variant="outline" onClick={() => void copy()} className="w-full">
          {copied ? <Check className="h-4 w-4 text-positive" strokeWidth={1.8} aria-hidden="true" /> : <Copy className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />}
          {copied ? t.copied : t.copy}
        </Button>

        {/* تأكيد صريح قبل الإغلاق. */}
        <label className="flex items-start gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[color:var(--primary)]"
          />
          <span>{t.confirm}</span>
        </label>

        {dismissBlocked && !confirmed ? (
          <p role="status" className="text-sm text-warning" data-testid="secret-dismiss-hint">{t.confirmHint}</p>
        ) : null}

        <div className="flex justify-end">
          <Button type="button" onClick={close} disabled={!confirmed} title={!confirmed ? t.confirmHint : undefined}>
            {t.confirm}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

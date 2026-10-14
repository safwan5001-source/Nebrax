'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { useCommonLabel } from '@/lib/ui-label';

type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

interface ToastContextValue {
  toast: (input: ToastInput) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DURATION = 4000;
/** الخطأ يبقى أطول: نصّه يحتاج قراءةً وقراراً، لا تأكيداً عابراً (ERP-UX-004). */
const ERROR_DURATION = 8000;

const VARIANTS: Record<ToastVariant, { Icon: typeof CheckCircle2; color: string }> = {
  success: { Icon: CheckCircle2, color: 'var(--positive)' },
  error: { Icon: XCircle, color: 'var(--negative)' },
  warning: { Icon: AlertTriangle, color: 'var(--warning)' },
  info: { Icon: Info, color: 'var(--primary)' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id = ++counter.current;
    setToasts((list) => [...list, { id, variant: 'info', ...input }]);
  }, []);

  const success = useCallback(
    (title: string, description?: string) => toast({ title, description, variant: 'success' }),
    [toast]
  );
  const error = useCallback(
    (title: string, description?: string) => toast({ title, description, variant: 'error' }),
    [toast]
  );

  return (
    <ToastContext.Provider value={{ toast, success, error }}>
      {children}
      {/* على الجوال: هامش متساوٍ من الجانبين بدل عرض كامل مُزاح يخرج عن الشاشة؛
          ومن sm فما فوق: الركن الطرفي بعرض أقصى. والحافة السفلية تحترم منطقة iOS الآمنة. */}
      <div className="no-print pointer-events-none fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[100] flex flex-col gap-2 sm:inset-x-auto sm:end-4 sm:w-full sm:max-w-sm">
        {toasts.map((t) => (
          <Toast key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const { Icon, color } = VARIANTS[item.variant];
  const dismissLabel = useCommonLabel('dismissNotification', { ar: 'إغلاق التنبيه', en: 'Dismiss notification' });
  const [paused, setPaused] = useState(false);
  const isError = item.variant === 'error';
  // الأب يمرّر دالة سطرية جديدة مع كل إضافة/إزالة تنبيه؛ لولا المرجع لأُعيد ضبط
  // مؤقّت كل التنبيهات الظاهرة كلما ظهر تنبيه آخر.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // يتوقف العدّ أثناء مرور المؤشر أو وجود التركيز داخل التنبيه، فلا يختفي وهو يُقرأ.
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => onDismissRef.current(), isError ? ERROR_DURATION : DURATION);
    return () => clearTimeout(timer);
  }, [paused, isError]);

  return (
    <div
      // الخطأ يُعلَن فوراً (alert)؛ النجاح والمعلومة بأدب (status).
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
      }}
      className="pointer-events-auto flex items-start gap-2.5 rounded border border-border bg-surface px-3.5 py-3 shadow-sm"
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} style={{ color }} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium text-text">{item.title}</p>
        {item.description && <p className="mt-0.5 break-words text-xs text-muted">{item.description}</p>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        className="flex h-11 w-11 shrink-0 items-center justify-center text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

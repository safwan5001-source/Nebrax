import { cn } from '@/lib/utils';

/**
 * شارة طريقة HTTP — رمزٌ مضغوط بخط Mono. **الوصولية لا تعتمد اللون** (§13): النصّ
 * (GET/POST/…) هو الإشارة دائماً، والمعاملة محايدة موحّدة فلا تصير ألوان الطرق لوحةً
 * زخرفية ثانية تنافس لون الهوية الوحيد. حدٌّ خفيف وخلفية سطح — للتمييز البصري لا للزينة.
 */
export function MethodBadge({ method, className }: { method: string; className?: string }) {
  return (
    <span
      dir="ltr"
      className={cn(
        'inline-flex items-center rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-text',
        className,
      )}
    >
      {method}
    </span>
  );
}

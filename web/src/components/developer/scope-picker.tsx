'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { parseScope } from '@/lib/developer';
import { cn } from '@/lib/utils';

/**
 * منتقي النطاقات — يجمع النطاقات منطقياً حسب المورد ويميّز القراءة عن الكتابة صراحةً
 * (§9). يعرض شرحاً بشرياً (عربي/إنجليزي) مع **حفظ نصّ النطاق التقني حرفياً** (`partners:read`).
 * لا wildcard: الخيارات من كتالوج العقد فقط. القيمة مصفوفة نصوص النطاقات المحدَّدة.
 */
export function ScopePicker({
  scopes,
  value,
  onChange,
  disabled,
  error,
}: {
  scopes: string[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  error?: string;
}) {
  const t = useTranslations('developer.scopes');

  // تجميع حسب المورد بترتيب ظهوره في الكتالوج، والقراءة قبل الكتابة داخل كل مورد.
  const groups = useMemo(() => {
    const order: string[] = [];
    const byResource = new Map<string, string[]>();
    for (const scope of scopes) {
      const { resource } = parseScope(scope);
      if (!byResource.has(resource)) {
        byResource.set(resource, []);
        order.push(resource);
      }
      byResource.get(resource)!.push(scope);
    }
    const rank = (scope: string) => (parseScope(scope).action === 'read' ? 0 : 1);
    return order.map((resource) => ({
      resource,
      items: [...byResource.get(resource)!].sort((a, b) => rank(a) - rank(b)),
    }));
  }, [scopes]);

  const toggle = (scope: string) => {
    onChange(value.includes(scope) ? value.filter((entry) => entry !== scope) : [...value, scope]);
  };

  return (
    <div className={cn('space-y-2', error && 'rounded border border-negative/40 p-2')}>
      {groups.map(({ resource, items }) => (
        <fieldset key={resource} className="rounded border border-border">
          <legend className="px-2 text-xs font-medium text-muted">{t(`resources.${resource}`)}</legend>
          <div className="grid gap-px sm:grid-cols-2">
            {items.map((scope) => {
              const { action } = parseScope(scope);
              const checked = value.includes(scope);
              return (
                <label
                  key={scope}
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 p-2.5 transition-colors',
                    checked ? 'bg-primary-soft' : 'hover:bg-background',
                    disabled && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(scope)}
                    className="mt-0.5 h-4 w-4 accent-[color:var(--primary)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <code dir="ltr" className="font-mono text-xs text-text">{scope}</code>
                      <Badge tone={action === 'write' ? 'warning' : 'muted'}>
                        {action === 'write' ? t('write') : t('read')}
                      </Badge>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">{t(`descriptions.${scope}`)}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      {error ? <p className="text-xs text-negative" role="alert">{error}</p> : null}
    </div>
  );
}

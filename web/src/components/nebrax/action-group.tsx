'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MoreHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { cn } from '@/lib/utils';

/**
 * وصف إجراء صفحة واحد — تصريحي لا JSX، فتبقى ترتيبَ الإجراءات ومنطقُ الطيّ
 * قراراً واحداً مشتركاً بين كل الصفحات بدل أن تعيد كل شاشة اختراعه.
 */
export interface PageAction {
  key: string;
  label: string;
  icon?: LucideIcon;
  href?: string;
  onClick?: () => void;
  variant?: 'primary' | 'outline' | 'ghost' | 'danger';
  /** إجراء `primary` لا يُطوى في قائمة الفائض مهما ضاقت الشاشة. */
  emphasis?: 'primary' | 'secondary';
  disabled?: boolean;
  title?: string;
  /** لاحقة رقمية صغيرة بجانب النص (مثل عدد العناصر المتأثرة). */
  hint?: string;
  'aria-label'?: string;
}

function emphasisOf(action: PageAction): 'primary' | 'secondary' {
  return action.emphasis ?? (action.variant === 'primary' || action.variant === undefined ? 'primary' : 'secondary');
}

function ActionButton({ action, className }: { action: PageAction; className?: string }) {
  const Icon = action.icon;
  const content = (
    <>
      {Icon ? <Icon className="h-4 w-4 shrink-0" strokeWidth={1.7} aria-hidden="true" /> : null}
      <span className="truncate">{action.label}</span>
      {action.hint ? <span className="num text-xs opacity-70">{action.hint}</span> : null}
    </>
  );

  if (action.href && !action.disabled) {
    return (
      <Button asChild variant={action.variant ?? 'primary'} className={className} title={action.title}>
        <Link href={action.href} aria-label={action['aria-label']}>
          {content}
        </Link>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant={action.variant ?? 'primary'}
      className={className}
      onClick={action.onClick}
      disabled={action.disabled}
      title={action.title}
      aria-label={action['aria-label']}
    >
      {content}
    </Button>
  );
}

/**
 * تجميع إجراءات مستجيب: الإجراءات الأساسية تبقى ظاهرة دائماً، والثانوية تظهر
 * حتى `inlineLimit` ثم ينزل ما زاد إلى قائمة فائض واحدة.
 *
 * على الجوال يتمدّد كل زر ليملأ سطره (`flex-1`) فيصير هدف اللمس كبيراً وواضحاً،
 * ويعود إلى عرضه الطبيعي من `sm` فما فوق حيث تُقاس الكثافة لا الإصبع.
 */
export function ActionGroup({
  actions,
  inlineLimit = 2,
  overflowLabel,
  className,
}: {
  actions: PageAction[];
  inlineLimit?: number;
  /** يتجاوز التسمية المترجمة حين يحتاج السياق اسماً أدقّ من «إجراءات إضافية». */
  overflowLabel?: string;
  className?: string;
}) {
  const t = useTranslations('nebrax');
  const overflowMenuLabel = overflowLabel ?? t('moreActions');
  const visible = actions.filter(Boolean);
  if (visible.length === 0) return null;

  const primary = visible.filter((action) => emphasisOf(action) === 'primary');
  const secondary = visible.filter((action) => emphasisOf(action) === 'secondary');
  const inlineSecondary = secondary.slice(0, Math.max(0, inlineLimit));
  const overflow = secondary.slice(Math.max(0, inlineLimit));

  return (
    <div className={cn('flex w-full flex-wrap items-center gap-2 sm:w-auto', className)}>
      {inlineSecondary.map((action) => (
        <ActionButton key={action.key} action={action} className="flex-1 sm:flex-none" />
      ))}

      {overflow.length > 0 ? (
        <Dropdown
          align="end"
          menuLabel={overflowMenuLabel}
          triggerLabel={overflowMenuLabel}
          mobilePopover
          triggerClassName="h-9 w-9 justify-center border border-border bg-surface text-text hover:bg-primary-soft"
          trigger={<MoreHorizontal className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />}
        >
          {overflow.map((action) => (
            <DropdownItem
              key={action.key}
              icon={action.icon}
              href={action.disabled ? undefined : action.href}
              onClick={action.onClick}
              disabled={action.disabled}
              tone={action.variant === 'danger' ? 'danger' : 'default'}
            >
              {action.hint ? `${action.label} ${action.hint}` : action.label}
            </DropdownItem>
          ))}
        </Dropdown>
      ) : null}

      {primary.map((action) => (
        <ActionButton key={action.key} action={action} className="flex-1 sm:flex-none" />
      ))}
    </div>
  );
}

'use client';

import Link from 'next/link';
import {
  Ban, Calendar, CalendarRange, CheckSquare, Copy, CreditCard, FilePlus, FileText,
  LogIn, MoreHorizontal, Package, PackageOpen, Pencil, Printer, Receipt, Trash2,
  UserCog, Wallet, type LucideIcon,
} from 'lucide-react';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { cn } from '@/lib/utils';

/**
 * شريط إجراءات ملف العميل — **ظاهر دائماً**، وزرّ (⋮) في نهايته للخيارات الثانوية.
 *
 * قاعدة التقسيم: كل ما يُنشئ مستنداً أو يفتح شاشة يومية يبقى في الشريط؛ وما هو
 * إداري أو نادر أو خطِر (حذف، إيقاف، دخول كعميل) يسكن القائمة المنسدلة.
 *
 * الإجراء بلا مسار جاهز في النظام يُعرَض **معطّلاً** لا مخفيّاً — فالمستخدم يعرف
 * أن الميزة قادمة بدل أن يظنّها غير موجودة.
 */
export interface PartnerAction {
  key: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  danger?: boolean;
  /** فاصل بصري قبل هذا العنصر (تجميع منطقي). */
  separatorBefore?: boolean;
}

/** إجراءات الشريط الرئيسي — الأول بارز باللون الأساسي. */
export function primaryActions(t: (k: string) => string, partnerId: string): PartnerAction[] {
  return [
    { key: 'new_invoice',   label: t('new_invoice'),   icon: FilePlus,      href: '/invoices/new' },
    { key: 'edit',          label: t('edit'),          icon: Pencil,        href: `/partners/${partnerId}/edit` },
    { key: 'note',          label: t('note'),          icon: FileText },
    { key: 'appointment',   label: t('appointment'),   icon: Calendar },
    { key: 'new_quote',     label: t('new_quote'),     icon: Receipt,       href: '/quotes/new' },
    { key: 'new_credit',    label: t('new_credit'),    icon: CreditCard,    href: '/credit-notes/new' },
    { key: 'statement',     label: t('statement'),     icon: CalendarRange, href: `/partners/${partnerId}?section=ledger`, separatorBefore: true },
    { key: 'payment_credit', label: t('payment_credit'), icon: Wallet },
    { key: 'parcels_in',    label: t('parcels_in'),    icon: PackageOpen },
    { key: 'parcels_out',   label: t('parcels_out'),   icon: Package },
    { key: 'settlement',    label: t('settlement'),    icon: CheckSquare,   separatorBefore: true },
    { key: 'prints',        label: t('prints'),        icon: Printer },
  ];
}

/** خيارات القائمة المنسدلة — ثانوية فقط. */
export function overflowActions(t: (k: string) => string): PartnerAction[] {
  return [
    { key: 'opening_balance', label: t('opening_balance'), icon: Wallet },
    { key: 'shipment',        label: t('shipment'),        icon: Package },
    { key: 'login_as',        label: t('login_as'),        icon: LogIn },
    { key: 'suspend',         label: t('suspend'),         icon: Ban,     separatorBefore: true },
    { key: 'duplicate',       label: t('duplicate'),       icon: Copy },
    { key: 'assign',          label: t('assign'),          icon: UserCog },
    { key: 'delete',          label: t('delete'),          icon: Trash2,  danger: true, separatorBefore: true },
  ];
}

function ActionButton({ action, primary }: { action: PartnerAction; primary?: boolean }) {
  const Icon = action.icon;
  const className = cn(
    'inline-flex items-center gap-2 whitespace-nowrap rounded border px-3 py-2 text-xs font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
    primary
      ? 'border-transparent bg-primary text-white hover:bg-primary-hover'
      : 'border-border bg-surface text-text hover:bg-primary-soft',
    !action.href && !primary && 'cursor-not-allowed opacity-50'
  );
  const inner = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
      {action.label}
    </>
  );

  if (action.href) {
    return (
      <Link href={action.href} className={className}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" disabled className={className} title={action.label}>
      {inner}
    </button>
  );
}

export function OverflowMenu({
  actions,
  label,
  className,
}: {
  actions: PartnerAction[];
  label: string;
  className?: string;
}) {
  return (
    <Dropdown
      align="end"
      menuLabel={label}
      triggerClassName={cn(
        'h-9 w-9 justify-center rounded border border-border bg-surface text-text hover:bg-primary-soft',
        className
      )}
      menuClassName="w-56"
      trigger={<MoreHorizontal className="h-4 w-4" strokeWidth={1.9} aria-label={label} />}
    >
      {actions.map((a) => (
        <div key={a.key}>
          {a.separatorBefore && <div className="my-1 border-t border-border" />}
          <DropdownItem icon={a.icon} href={a.href} tone={a.danger ? 'danger' : 'default'}>
            {a.label}
          </DropdownItem>
        </div>
      ))}
    </Dropdown>
  );
}

/** الشريط الكامل (ديسكتوب): إجراءات ظاهرة + ⋮ في نهايته. */
export function ActionBar({
  actions,
  overflow,
  overflowLabel,
}: {
  actions: PartnerAction[];
  overflow: PartnerAction[];
  overflowLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-surface p-3">
      {actions.map((a, i) => (
        <div key={a.key} className="flex items-center gap-2">
          {a.separatorBefore && <span aria-hidden className="mx-0.5 h-6 w-px bg-border" />}
          <ActionButton action={a} primary={i === 0} />
        </div>
      ))}
      <span aria-hidden className="mx-0.5 h-6 w-px bg-border" />
      <OverflowMenu actions={overflow} label={overflowLabel} />
    </div>
  );
}

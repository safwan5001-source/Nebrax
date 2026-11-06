'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { FreshnessBadge, LevelSummary, tankHref } from './parts';
import type { TankLevel } from './schemas';

/** بطاقة خزان قابلة للمس (≥ 64px) تفتح تفاصيله وتسجيل القراءة. خصائص منطقية فقط (RTL/LTR). */
export function TankCard({ row, timeZone }: { row: TankLevel; timeZone: string | null | undefined }) {
  const { tank, fuel_product: product, level } = row;
  return (
    <li>
      <Link
        href={tankHref(tank.id)}
        data-tank-card={tank.id}
        data-review={level.needs_review ? 'true' : undefined}
        className="block rounded-[14px] border border-border bg-surface p-4 hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="flex items-start gap-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-semibold text-text">{tank.name}</span>
            <span className="block truncate text-sm text-muted">{[product.name, tank.code].filter(Boolean).join(' · ')}</span>
          </span>
          <FreshnessBadge freshness={level.freshness} />
          <ChevronLeft aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted ltr:rotate-180" strokeWidth={1.8} />
        </span>
        <span className="mt-3 block"><LevelSummary row={row} timeZone={timeZone} /></span>
      </Link>
    </li>
  );
}

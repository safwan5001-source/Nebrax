import * as React from 'react';
import { cn } from '@/lib/utils';

export function Table({
  className,
  wrapperProps,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & { wrapperProps?: React.HTMLAttributes<HTMLDivElement> }) {
  const { className: wrapperClassName, ...wrapperRest } = wrapperProps ?? {};
  return (
    <div data-awj-grid-scroll="" className={cn('w-full overflow-x-auto', wrapperClassName)} {...wrapperRest}>
      <table data-awj-grid-table="" className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead data-awj-grid-head="" className={cn('border-b border-border text-muted', className)} {...props} />;
}

export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      data-awj-row=""
      className={cn('border-b border-border last:border-0 hover:bg-primary-soft/40', className)}
      {...props}
    />
  );
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th data-awj-th="" className={cn('px-3 py-2 text-start font-medium', className)} {...props} />;
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td data-awj-td="" className={cn('px-3 py-2', className)} {...props} />;
}

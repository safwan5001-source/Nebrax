import * as React from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-awj-card className={cn('rounded border border-border bg-surface', className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pb-2', className)} {...props} />;
}

type CardTitleProps = React.HTMLAttributes<HTMLHeadingElement> & {
  /** Heading level for the page outline. Defaults to h3; visual style does not depend on it. */
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
};

export function CardTitle({ className, as: Tag = 'h3', ...props }: CardTitleProps) {
  return <Tag data-awj-card-title className={cn('text-sm font-medium text-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pt-2', className)} {...props} />;
}

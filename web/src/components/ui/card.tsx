'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

/**
 * المستوى الافتراضي لعناوين البطاقات داخل مساحة عمل. خارج أي مزوّد يبقى `h3` كما قرّر
 * H15-11 لكل مستهلك قائم؛ تخطيطات ERP تضبطه `h2` لأن بطاقاتها تقع مباشرة تحت `h1`
 * الصفحة (ERP-UX-014). قسمٌ له عنوان `h2` خاص يعيد ضبطه `h3` لما بداخله.
 */
const DEFAULT_CARD_TITLE_TAG: HeadingTag = 'h3';
const CardTitleLevelContext = React.createContext<HeadingTag>(DEFAULT_CARD_TITLE_TAG);

export function CardTitleLevel({ level, children }: { level: HeadingTag; children: React.ReactNode }) {
  return <CardTitleLevelContext.Provider value={level}>{children}</CardTitleLevelContext.Provider>;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-awj-card className={cn('rounded border border-border bg-surface', className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pb-2', className)} {...props} />;
}

type CardTitleProps = React.HTMLAttributes<HTMLHeadingElement> & {
  /** Heading level for the page outline. Defaults to the nearest `CardTitleLevel` (h3 when none); visual style does not depend on it. */
  as?: HeadingTag;
};

export function CardTitle({ className, as, ...props }: CardTitleProps) {
  const contextLevel = React.useContext(CardTitleLevelContext);
  const Tag = as ?? contextLevel;
  return <Tag data-awj-card-title className={cn('text-sm font-medium text-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pt-2', className)} {...props} />;
}

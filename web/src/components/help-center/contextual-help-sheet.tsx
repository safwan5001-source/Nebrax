'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { BookOpen, Clock, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { getHelpCategory, helpLocale, type HelpArticle } from '@/modules/help-center/content';

export function ContextualHelpSheet({
  article,
  open,
  onOpenChange,
}: {
  article: HelpArticle;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('helpCenter');
  const locale = helpLocale(useLocale());
  const category = getHelpCategory(article.category);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent closeLabel={t('closeContextualHelp')} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <header className="shrink-0 border-b border-border px-5 pb-4 pe-14 pt-4">
          <p className="text-xs font-semibold text-primary">{t('contextualTitle')}</p>
          <SheetTitle className="mt-1 text-lg font-semibold text-text">{article.title[locale]}</SheetTitle>
          <SheetDescription className="mt-2 text-sm leading-6 text-muted">{article.summary[locale]}</SheetDescription>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span>{category.title[locale]}</span>
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
              {t('readingTime', { minutes: article.minutes })}
            </span>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="space-y-6">
            {article.sections.map((section) => (
              <section key={section.title[locale]} className="space-y-3">
                <h3 className="text-sm font-semibold text-text">{section.title[locale]}</h3>
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph[locale]} className="text-sm leading-6 text-text">{paragraph[locale]}</p>
                ))}
                {section.steps ? (
                  <ol className="space-y-3">
                    {section.steps.map((step, index) => (
                      <li key={step[locale]} className="flex gap-3 text-sm leading-6 text-text">
                        <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                          {index + 1}
                        </span>
                        <span>{step[locale]}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}
                {section.note ? (
                  <div className="flex gap-2.5 rounded border border-border bg-background p-3 text-sm leading-6 text-text">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} aria-hidden="true" />
                    <p>{section.note[locale]}</p>
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        </div>

        <footer className="shrink-0 border-t border-border p-4">
          <Button asChild className="w-full">
            <Link href={`/help/${article.slug}`} onClick={() => onOpenChange(false)}>
              <BookOpen className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              {t('openFullArticle')}
            </Link>
          </Button>
        </footer>
      </SheetContent>
    </Sheet>
  );
}

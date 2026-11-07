'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { BookOpen, CircleHelp, Clock } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { getFuelHelpCategory, helpLocale } from '@/modules/help-center/fuel';
import { resolveFuelContextualHelp } from '@/modules/help-center/fuel/context';
import { FuelHelpArticleBody, type FuelHelpSurface } from './fuel-help-article-body';

/**
 * زر «؟» السياقي: يفتح ورقة بمقتطف الدليل المرتبط بالشاشة الحالية ثم الدليل الكامل. لا شاشة مرتبطة ⇒ يذهب إلى المركز.
 * مصدر الربط الوحيد `resolveFuelContextualHelp`؛ لا شروط مسارات هنا. `buttonClassName` يلائم الرأس الكحلي في التطبيق أو شريط ERP.
 */
export function FuelContextualHelp({ basePath, surface, buttonClassName }: { basePath: string; surface: FuelHelpSurface; buttonClassName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('fuelHelp');
  const common = useTranslations('helpCenter');
  const locale = helpLocale(useLocale());
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const resolved = resolveFuelContextualHelp(pathname ?? '');
  const label = resolved ? t('contextualTitle') : t('contextualFallback');

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        onClick={() => (resolved ? setOpen(true) : router.push(basePath))}
        className={buttonClassName}
      >
        <CircleHelp aria-hidden="true" className="h-5 w-5" strokeWidth={1.7} />
      </button>

      {resolved ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            closeLabel={t('closeContextual')}
            dir={locale === 'ar' ? 'rtl' : 'ltr'}
            // الورقة تُرسم في بوابة خارج الجذر؛ داخل التطبيق تحمل رموز تصميمه (اللون البرتقالي) كي لا يتبدّل الطابع.
            {...(surface === 'app' ? { 'data-fuel-ops': '' } : {})}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              triggerRef.current?.focus();
            }}
          >
            <header className="shrink-0 border-b border-border px-5 pb-4 pe-14 pt-4">
              <p className="text-xs font-semibold text-primary">{t('contextualTitle')}</p>
              <SheetTitle className="mt-1 text-lg font-semibold leading-7 text-text">{resolved.article.title[locale]}</SheetTitle>
              <SheetDescription className="mt-2 text-sm leading-6 text-muted">{resolved.article.summary[locale]}</SheetDescription>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                <span>{getFuelHelpCategory(resolved.article.category).title[locale]}</span>
                <span className="flex items-center gap-1.5"><Clock aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.7} />{common('readingTime', { minutes: resolved.article.minutes })}</span>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <FuelHelpArticleBody article={resolved.article} locale={locale} surface={surface} compact />
            </div>
            <footer className="shrink-0 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Link
                href={`${basePath}/${resolved.article.slug}`}
                onClick={() => setOpen(false)}
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-primary text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <BookOpen aria-hidden="true" className="h-4 w-4" strokeWidth={1.7} />{t('openFullArticle')}
              </Link>
            </footer>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}

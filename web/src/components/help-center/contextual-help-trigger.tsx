'use client';

import { useRef, useState, type RefObject } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CircleHelp } from 'lucide-react';
import { DropdownItem } from '@/components/ui/dropdown';
import { Button } from '@/components/ui/button';
import { resolveContextualHelp } from '@/modules/help-center/context';
import { ContextualHelpSheet } from './contextual-help-sheet';

export function ContextualHelpTrigger({
  placement,
  restoreFocusRef,
}: {
  placement: 'topbar' | 'menu';
  restoreFocusRef?: RefObject<HTMLElement>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const topbar = useTranslations('topbar');
  const help = useTranslations('helpCenter');
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const focusTargetRef = restoreFocusRef ?? triggerRef;
  const contextualHelp = resolveContextualHelp(pathname);
  const label = contextualHelp ? help('contextualTitle') : topbar('help');

  const activate = () => {
    if (contextualHelp) {
      setOpen(true);
      return;
    }
    router.push('/help');
  };

  return (
    <>
      {placement === 'topbar' ? (
        <Button
          ref={triggerRef}
          variant="ghost"
          size="icon"
          className="hidden h-11 w-11 text-muted hover:bg-primary-soft hover:text-primary sm:inline-flex"
          aria-label={label}
          title={label}
          onClick={activate}
        >
          <CircleHelp className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
        </Button>
      ) : (
        <DropdownItem icon={CircleHelp} onClick={activate}>{label}</DropdownItem>
      )}

      {contextualHelp ? (
        <ContextualHelpSheet
          article={contextualHelp.article}
          open={open}
          onOpenChange={setOpen}
          restoreFocusRef={focusTargetRef}
        />
      ) : null}
    </>
  );
}

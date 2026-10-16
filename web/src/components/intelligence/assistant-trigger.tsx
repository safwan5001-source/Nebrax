'use client';

import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownItem } from '@/components/ui/dropdown';
import { useCan } from '@/lib/use-can';
import { canSeeAssistant } from '@/modules/intelligence/gate';
import { useIntelligence, useOptionalIntelligence } from '@/modules/intelligence/store';

function useVisible(): boolean {
  const { can, hydrated } = useCan();
  return hydrated && canSeeAssistant(can);
}

function TriggerButton() {
  const t = useTranslations('intelligence.trigger');
  const store = useIntelligence();
  if (!useVisible()) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="hidden h-11 w-11 shrink-0 text-text hover:text-primary sm:inline-flex"
      aria-label={t('label')}
      aria-haspopup="dialog"
      aria-expanded={store.panelOpen}
      data-awj-assistant-trigger=""
      onClick={store.openPanel}
    >
      <Sparkles className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
    </Button>
  );
}

/** زر الشريط العلوي (من sm فما فوق). خارج المزوّد لا يُرسَم شيء ولا يُقرأ أي مستخدم. */
export function AssistantTrigger() {
  return useOptionalIntelligence() ? <TriggerButton /> : null;
}

function MenuEntry() {
  const t = useTranslations('intelligence.trigger');
  const store = useIntelligence();
  if (!useVisible()) return null;
  return (
    <div className="sm:hidden">
      <DropdownItem icon={Sparkles} onClick={store.openPanel}>{t('label')}</DropdownItem>
    </div>
  );
}

/** العنصر نفسه في قائمة الحساب على الجوال (<sm) حيث لا يتّسع الشريط. */
export function AssistantMenuItem() {
  return useOptionalIntelligence() ? <MenuEntry /> : null;
}

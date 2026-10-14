'use client';

import { useTranslations } from 'next-intl';
import { SecretRevealDialog as NeutralSecretRevealDialog } from '@/components/shared/secret-reveal-dialog';

/**
 * عرض السرّ **لمرّة واحدة** (مفتاح API أو سرّ توقيع Webhook) في شاشات المطوّر — سطح أمنيّ حرِج (§9/§29).
 * غلافٌ رقيق على المكوّن المحايد `components/shared/secret-reveal-dialog` يربطه بترجمات `developer.secret`
 * (INT-UX-5a): الاسم والمسار والخاصيات والسلوك كما كانت حرفياً، فلا يتغيّر أي مستدعٍ ولا أي اختبار قائم.
 */
export function SecretRevealDialog({
  open,
  onClose,
  title,
  secret,
  description,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  secret: string;
  description?: string;
}) {
  const t = useTranslations('developer.secret');
  return (
    <NeutralSecretRevealDialog
      open={open}
      onClose={onClose}
      title={title}
      secret={secret}
      description={description}
      labels={{
        warning: t('warning'),
        copied: t('copied'),
        confirm: t('confirm'),
        confirmHint: t('confirmHint'),
        reveal: t('reveal'),
        hide: t('hide'),
        copy: t('copy'),
      }}
    />
  );
}

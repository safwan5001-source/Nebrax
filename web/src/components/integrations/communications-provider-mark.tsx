'use client';

import { useState } from 'react';
import { Bell, Mail, MessageCircle, MessageSquareText, type LucideIcon } from 'lucide-react';
import type { CommunicationChannelKey, CommunicationProvider } from '@/lib/communications-providers';

/**
 * شعار المزوّد: الأصل الرسمي الموثّق فقط (`logo.kind === 'official'`) بلا تلوين ولا قصّ ولا تغيير نسبة،
 * وإلا أيقونة القناة العامة (لا حرف مرسوم ولا تقريب لعلامة). فشل تحميل الأصل يعود للأيقونة العامة.
 * الاسم نصٌّ ظاهر يجاور الشعار دائماً، فالشعار زخرفة (`alt=""`).
 */
export const CHANNEL_ICONS: Record<CommunicationChannelKey, LucideIcon> = {
  sms: MessageSquareText,
  whatsapp: MessageCircle,
  email: Mail,
  push: Bell,
};

export function CommunicationProviderMark({ provider }: { provider: CommunicationProvider }) {
  const [broken, setBroken] = useState(false);
  const Icon = CHANNEL_ICONS[provider.channel];
  const src = provider.logo.kind === 'official' && !broken ? provider.logo.src : null;

  return src ? (
    <img
      src={src}
      alt=""
      width={32}
      height={32}
      data-mark="official"
      onError={() => setBroken(true)}
      className="h-8 w-8 shrink-0 object-contain"
    />
  ) : (
    <span
      aria-hidden
      data-mark="generic"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted"
    >
      <Icon className="h-4 w-4" strokeWidth={1.7} />
    </span>
  );
}

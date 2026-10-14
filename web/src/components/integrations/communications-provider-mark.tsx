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
  const logo = provider.logo.kind === 'official' && !broken ? provider.logo : null;

  if (!logo) {
    return (
      <span
        aria-hidden
        data-mark="generic"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted"
      >
        <Icon className="h-4 w-4" strokeWidth={1.7} />
      </span>
    );
  }

  // الشعار نفسه لا يُلوَّن: الحامل الفاتح (`backing: 'light'`) للشعارات الداكنة الشفافة كي تُقرأ في الوضع الداكن.
  // الأفقي يحجز عرضه الطبيعي عند ارتفاع 32px؛ المربّع يملأ خانة 32×32 — كلاهما `object-contain` فلا قصّ ولا تمدّد.
  const wide = logo.shape === 'wide';
  return (
    <span
      data-mark="official"
      data-shape={logo.shape}
      data-backing={logo.backing}
      className={[
        'flex h-8 shrink-0 items-center justify-center',
        wide ? 'w-24' : 'w-8',
        logo.backing === 'light' ? 'rounded-md border border-border px-1.5 py-1' : '',
      ].join(' ')}
      // لون حامل الشعار ثابت عمداً لا رمز دلالي: شعار المالك مرسوم لخلفية بيضاء ولا يتبدّل بتبدّل السمة،
      // وإلا اختفى في الوضع الداكن. كلمة لون لا فئة لوحة، فلا تدخل سقف drift-ratchet (الشعار نفسه لا يُلوَّن).
      style={logo.backing === 'light' ? { backgroundColor: 'white' } : undefined}
    >
      <img
        src={logo.src}
        alt=""
        width={logo.width}
        height={logo.height}
        onError={() => setBroken(true)}
        className="h-full w-full object-contain"
      />
    </span>
  );
}

'use client';

import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { ThemeProvider } from 'next-themes';
import { ToastProvider } from './ui/toast';
import { ConfirmProvider } from './ui/confirm-dialog';

export function Providers({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: AbstractIntlMessages;
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Riyadh">
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}

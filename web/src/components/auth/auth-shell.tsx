/** Nebrax auth design: a compact RTL-first account entry surface using the shared system tokens, logo, and utilities. */

import Link from 'next/link';
import type { ReactNode } from 'react';
import { LangToggle } from '@/components/layout/lang-toggle';
import { NebraxLogo } from '@/components/layout/nebrax-logo';
import { ThemeToggle } from '@/components/layout/theme-toggle';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative min-h-screen bg-background px-4 pb-8 pt-20 sm:flex sm:items-center sm:justify-center sm:p-8">
      <div className="absolute end-4 top-4 flex items-center gap-1">
        <LangToggle />
        <ThemeToggle />
      </div>

      <div className="mx-auto w-full max-w-md">
        <Link href="/" className="mb-6 flex justify-center" aria-label="نبراكس">
          <NebraxLogo alt="نبراكس" className="h-14 w-auto sm:h-16" priority />
        </Link>
        {children}
      </div>
    </main>
  );
}

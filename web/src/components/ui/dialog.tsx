'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative z-10 my-8 flex max-h-[calc(100dvh-2rem)] w-full min-w-0 max-w-lg flex-col overflow-hidden rounded border border-border bg-surface sm:max-h-[calc(100dvh-4rem)]',
          className
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <h2 className="min-w-0 truncate text-base font-semibold text-text">{title}</h2>
          <button type="button" onClick={onClose} className="shrink-0 rounded text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label="إغلاق">
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
        <div className="min-w-0 overflow-y-auto overflow-x-hidden p-4 [&_pre]:max-w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-all">{children}</div>
      </div>
    </div>
  );
}

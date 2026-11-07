'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, FileUp } from 'lucide-react';
import { ACCEPT_ATTR, ACCEPT_IMAGE_ATTR, checkFiles, prepareImage, type FileCheck } from './attachments';

/**
 * FUEL-B5.1 — اختيار ملفات السند: «تصوير» (كاميرا الآيفون الخلفية عبر `capture`) و«اختيار ملف» (PDF/JPG/PNG من الملفات أو المعرض).
 * لا رفع هنا: يعيد الملفات المقبولة محلياً (بعد ضغط الصور الكبيرة best-effort) والمرفوضة بأسبابها، والمستدعي يقرر متى يرفع (بفعل صريح).
 */
export function FilePicker({ existing, disabled = false, onPicked }: { existing: number; disabled?: boolean; onPicked: (result: FileCheck) => void }) {
  const t = useTranslations('stationOps');
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);

  const handle = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(event.target.files ?? []);
    event.target.value = ''; // يسمح باختيار الملف نفسه مجدداً
    if (list.length === 0) return;
    const prepared = await Promise.all(list.map((file) => prepareImage(file)));
    onPicked(checkFiles(prepared, existing));
  };

  const button = 'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[13px] border border-[color:var(--fo-control)] bg-surface px-3 text-[15px] font-semibold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50';
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <input ref={camera} type="file" accept={ACCEPT_IMAGE_ATTR} capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" data-camera-input="" onChange={(event) => void handle(event)} />
      <input ref={files} type="file" accept={ACCEPT_ATTR} multiple className="sr-only" tabIndex={-1} aria-hidden="true" data-file-input="" onChange={(event) => void handle(event)} />
      <button type="button" disabled={disabled} onClick={() => camera.current?.click()} className={button} data-take-photo="">
        <Camera aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />{t('receiving.attach.takePhoto')}
      </button>
      <button type="button" disabled={disabled} onClick={() => files.current?.click()} className={button} data-choose-file="">
        <FileUp aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />{t('receiving.attach.chooseFile')}
      </button>
    </div>
  );
}

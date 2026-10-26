'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImagePlus, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchImageUrl } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ICON_KEYS, ICON_REGISTRY, LOGO_ACCEPT, LOGO_MAX_BYTES, LOGO_TYPES, isHexColor, logoPath, type IconKey, type VisualMode } from './visual';

/** حالة التخصيص داخل نموذج الطريقة. `iconColor === ''` = اللون الافتراضي. */
export interface VisualFormState {
  mode: VisualMode;
  iconKey: IconKey | '';
  iconColor: string;
  /** شعار محفوظ مسبقاً على الخادم (لعرضه ومعرفة إن كان وضع الصورة ممكناً بلا رفع). */
  hasLogo: boolean;
  /** ملف مُنتقى لم يُرفع بعد. */
  logoFile: File | null;
}

export const EMPTY_VISUAL: VisualFormState = { mode: 'default', iconKey: '', iconColor: '', hasLogo: false, logoFile: null };

interface Props {
  value: VisualFormState;
  onChange: (next: VisualFormState) => void;
  /** مرجع الطريقة المحفوظة لعرض شعارها الحالي؛ غيابه (إنشاء) = لا شعار محفوظ. */
  saved?: { id: string; updated_at?: string | null } | null;
  disabled?: boolean;
}

/** منتقي «أيقونة أو صورة طريقة الدفع»: ثلاثة أوضاع متنافية، وبقية الحالة تُحفظ في الذاكرة حتى يرجع المستخدم لها. */
export function PaymentMethodVisualPicker({ value, onChange, saved, disabled = false }: Props) {
  const t = useTranslations('paymentMethods.visual');
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // معاينة فورية: الملف المنتقى أولاً، وإلا الشعار المحفوظ (يُجلب مصادَقاً).
  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    if (value.logoFile) {
      revoke = URL.createObjectURL(value.logoFile);
      setPreviewUrl(revoke);
    } else if (value.hasLogo && saved?.id) {
      setPreviewUrl(null);
      fetchImageUrl(logoPath({ id: saved.id, updated_at: saved.updated_at })).then((url) => { if (!cancelled) setPreviewUrl(url); }).catch(() => { if (!cancelled) setPreviewUrl(null); });
    } else {
      setPreviewUrl(null);
    }
    return () => { cancelled = true; if (revoke) URL.revokeObjectURL(revoke); };
  }, [value.logoFile, value.hasLogo, saved?.id, saved?.updated_at]);

  const patch = (next: Partial<VisualFormState>) => onChange({ ...value, ...next });
  const colorValid = value.iconColor === '' || isHexColor(value.iconColor);
  const pickerColor = isHexColor(value.iconColor) ? value.iconColor : '#000000';

  function pickFile(file: File | undefined) {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) { setFileError(t('errorType')); return; }
    if (file.size > LOGO_MAX_BYTES) { setFileError(t('errorSize')); return; }
    setFileError(null);
    patch({ logoFile: file, mode: 'image' });
  }

  const modes: { id: VisualMode; label: string }[] = [
    { id: 'default', label: t('modeDefault') },
    { id: 'icon', label: t('modeIcon') },
    { id: 'image', label: t('modeImage') },
  ];

  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3" data-testid="payment-method-visual-picker" disabled={disabled}>
      <legend className="px-1 text-xs font-medium text-muted">{t('title')}</legend>

      <div role="radiogroup" aria-label={t('title')} className="grid grid-cols-3 gap-1 rounded-md bg-muted/40 p-1">
        {modes.map((mode) => (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={value.mode === mode.id}
            onClick={() => patch({ mode: mode.id })}
            className={cn('min-h-9 touch-manipulation rounded px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', value.mode === mode.id ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text')}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {value.mode === 'icon' && (
        <div className="space-y-3">
          <div role="group" aria-label={t('iconGroup')} className="grid grid-cols-5 gap-1.5 sm:grid-cols-7">
            {ICON_KEYS.map((key) => {
              const Icon = ICON_REGISTRY[key];
              const selected = value.iconKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selected}
                  aria-label={t(`icons.${key}`)}
                  title={t(`icons.${key}`)}
                  onClick={() => patch({ iconKey: key })}
                  className={cn('flex h-11 touch-manipulation items-center justify-center rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40', selected ? 'border-primary bg-primary-soft' : 'border-border hover:bg-muted/50')}
                >
                  <Icon className="h-5 w-5" strokeWidth={1.7} style={selected && isHexColor(value.iconColor) ? { color: value.iconColor } : undefined} />
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-hex`}>{t('color')}</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label={t('colorPicker')}
                value={pickerColor}
                onChange={(event) => patch({ iconColor: event.target.value.toUpperCase() })}
                className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-border bg-surface p-1"
              />
              <Input
                id={`${uid}-hex`}
                dir="ltr"
                inputMode="text"
                maxLength={7}
                placeholder="#RRGGBB"
                value={value.iconColor}
                aria-invalid={!colorValid}
                onChange={(event) => patch({ iconColor: event.target.value.trim().toUpperCase() })}
                className="num max-w-32"
              />
              <Button type="button" variant="outline" size="sm" disabled={value.iconColor === ''} onClick={() => patch({ iconColor: '' })}>
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />{t('resetColor')}
              </Button>
            </div>
            {!colorValid && <p className="text-xs text-negative">{t('errorColor')}</p>}
            <p className="text-xs text-muted">{t('colorHint')}</p>
          </div>
        </div>
      )}

      {value.mode === 'image' && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/30" data-testid="payment-method-logo-preview">
              {previewUrl ? <img src={previewUrl} alt={t('previewAlt')} className="h-full w-full object-contain" /> : <ImagePlus className="h-6 w-6 text-muted" strokeWidth={1.5} aria-hidden />}
            </div>
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept={LOGO_ACCEPT} className="sr-only" aria-label={t('uploadInput')} onChange={(event) => { pickFile(event.target.files?.[0]); event.target.value = ''; }} />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <ImagePlus className="h-3.5 w-3.5" strokeWidth={1.8} />{value.logoFile || value.hasLogo ? t('replace') : t('upload')}
              </Button>
              {(value.logoFile || value.hasLogo) && (
                <Button type="button" variant="ghost" size="sm" onClick={() => { setFileError(null); patch({ logoFile: null, hasLogo: false, mode: 'default' }); }}>
                  <Trash2 className="h-3.5 w-3.5 text-negative" strokeWidth={1.8} />{t('remove')}
                </Button>
              )}
            </div>
          </div>
          {fileError && <p role="alert" className="text-xs text-negative">{fileError}</p>}
          <p className="text-xs text-muted">{t('imageHint')}</p>
        </div>
      )}

      {value.mode === 'default' && <p className="text-xs text-muted">{t('defaultHint')}</p>}
    </fieldset>
  );
}

'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CircleAlert, Eye, EyeOff, Fuel, LoaderCircle, LogIn, ShieldCheck, WifiOff } from 'lucide-react';
import { getStationToken } from '@/lib/api';
import { STATION_HOME_PATH, checkStoredSession, continueStationWithErpSession, erpSessionHint, stationLogin } from '@/lib/auth';
import { classifyLoginFailure, sanitizeEmployeeNo, sanitizePin, validateLogin, type LoginFailure, type LoginFieldError } from './login-logic';

/**
 * «محطات أَوْج» — دخول البائع/المشرف برقم الموظف + PIN (6 أرقام).
 *
 * - جوال أولاً (iPhone): لوحة أرقام أصلية للـPIN (`inputMode="numeric"`)، حقول ≥16px (لا تكبير تلقائي)، أهداف لمس ≥ 48px، منطقة آمنة،
 *   `100dvh`. RTL بخصائص منطقية؛ الأرقام لاتينية 0–9 دائماً و`dir="ltr"` للحقلين.
 * - لا تخزين لرقم الموظف ولا للـPIN (أجهزة مشتركة): الحقول في الذاكرة فقط وتُمسح الـPIN عند أي فشل.
 * - ردّ فشل واحد لكل أسباب الرفض (لا استدلال على وجود رقم)، و429 = تريّث لا قفل حساب.
 * - النجاح يفتح واجهة التشغيل مباشرة (`replace` فلا يعود المستخدم إلى الدخول بزر الرجوع).
 * - الجلسة المحفوظة الصالحة تُستأنف دون عرض النموذج.
 */
export function StationLoginScreen() {
  const t = useTranslations('stationOps');
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [employeeNo, setEmployeeNo] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [errors, setErrors] = useState<{ employeeNo?: LoginFieldError; pin?: LoginFieldError }>({});
  const [failure, setFailure] = useState<LoginFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // جلسة أَوْج مفتوحة في المتصفح نفسه (مدير): تُعرض «المتابعة بها» بموافقة صريحة فقط؛ لا تُستعمل ضمناً.
  const [erpHint, setErpHint] = useState<{ name: string } | null>(null);
  useEffect(() => { setErpHint(erpSessionHint()); }, []);
  const sending = useRef(false);
  const interacted = useRef(false);
  const pinRef = useRef<HTMLInputElement>(null);
  const employeeRef = useRef<HTMLInputElement>(null);
  const uid = useId();

  // جلسة محطة محفوظة وصالحة ⇒ لا نموذج: نتحقق عبر /me ثم نفتح التطبيق. أي تفاعل يُبطل النتيجة المتأخرة.
  useEffect(() => {
    if (typeof window === 'undefined' || getStationToken() === null) return;
    let cancelled = false;
    setRestoring(true);
    checkStoredSession().then((result) => {
      if (cancelled || interacted.current) return;
      if (result.status === 'valid' && result.user.station_session === true) routerRef.current.replace(STATION_HOME_PATH);
      else setRestoring(false);
    });
    return () => { cancelled = true; };
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    interacted.current = true;
    setFailure(null);

    const checked = validateLogin(employeeNo, pin);
    setErrors(checked.errors);
    if (!checked.ok) {
      (checked.errors.employeeNo ? employeeRef : pinRef).current?.focus();
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setFailure('offline');
      return;
    }

    sending.current = true;
    setBusy(true);
    try {
      await stationLogin(checked.employeeNo, checked.pin);
      router.replace(STATION_HOME_PATH);
    } catch (error) {
      setFailure(classifyLoginFailure(error));
      setPin('');
      setBusy(false);
      sending.current = false;
      pinRef.current?.focus();
    }
  }

  if (restoring) {
    return (
      <Shell>
        <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-24 text-sm text-muted">
          <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
          {t('login.restoring')}
        </div>
      </Shell>
    );
  }

  const fieldClass = (invalid: boolean) =>
    `h-14 w-full rounded-[13px] border bg-surface px-4 text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${invalid ? 'border-negative' : 'border-[color:var(--fo-control)]'}`;

  return (
    <Shell>
      <form onSubmit={onSubmit} noValidate aria-labelledby={`${uid}-title`} className="mx-auto w-full max-w-md space-y-5 px-5 pb-10">
        <h2 id={`${uid}-title`} className="sr-only">{t('login.title')}</h2>

        {failure ? <FailureNotice failure={failure} /> : null}

        <div>
          <label htmlFor={`${uid}-emp`} className="mb-1.5 block text-sm font-semibold text-text">{t('login.employeeNo')}</label>
          <input
            ref={employeeRef}
            id={`${uid}-emp`}
            name="employee_no"
            dir="ltr"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            placeholder={t('login.employeeNoPlaceholder')}
            value={employeeNo}
            onChange={(event) => { setEmployeeNo(sanitizeEmployeeNo(event.target.value)); if (errors.employeeNo) setErrors((current) => ({ ...current, employeeNo: undefined })); }}
            aria-invalid={Boolean(errors.employeeNo)}
            aria-describedby={errors.employeeNo ? `${uid}-emp-err` : `${uid}-emp-hint`}
            className={fieldClass(Boolean(errors.employeeNo))}
          />
          {errors.employeeNo
            ? <FieldError id={`${uid}-emp-err`}>{t(`login.error.${errors.employeeNo}`)}</FieldError>
            : <p id={`${uid}-emp-hint`} className="mt-1.5 text-xs text-muted">{t('login.employeeNoHint')}</p>}
        </div>

        <div>
          <label htmlFor={`${uid}-pin`} className="mb-1.5 block text-sm font-semibold text-text">{t('login.pin')}</label>
          <div className="relative">
            <input
              ref={pinRef}
              id={`${uid}-pin`}
              name="pin"
              type={showPin ? 'text' : 'password'}
              dir="ltr"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              maxLength={12}
              placeholder="••••••"
              value={pin}
              onChange={(event) => { setPin(sanitizePin(event.target.value)); if (errors.pin) setErrors((current) => ({ ...current, pin: undefined })); }}
              aria-invalid={Boolean(errors.pin)}
              aria-describedby={errors.pin ? `${uid}-pin-err` : `${uid}-pin-hint`}
              className={`${fieldClass(Boolean(errors.pin))} num pe-14 text-center text-2xl font-semibold tracking-[0.5em]`}
            />
            <button
              type="button"
              onClick={() => setShowPin((visible) => !visible)}
              aria-label={showPin ? t('login.hidePin') : t('login.showPin')}
              aria-pressed={showPin}
              className="absolute end-0 top-0 grid h-14 w-14 place-items-center rounded-e-[13px] text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {showPin ? <EyeOff aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} /> : <Eye aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />}
            </button>
          </div>
          {errors.pin
            ? <FieldError id={`${uid}-pin-err`}>{t(`login.error.${errors.pin}`)}</FieldError>
            : <p id={`${uid}-pin-hint`} className="mt-1.5 text-xs text-muted">{t('login.pinHint')}</p>}
        </div>

        <button
          type="submit"
          data-primary-action=""
          disabled={busy}
          aria-busy={busy}
          className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-[13px] bg-[color:var(--fo-cta-bg)] px-4 text-base font-bold text-[color:var(--fo-cta-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? <LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin" /> : <LogIn aria-hidden="true" className="h-5 w-5 rtl:-scale-x-100" strokeWidth={1.9} />}
          {busy ? t('login.submitting') : t('login.submit')}
        </button>

        {erpHint ? (
          <button
            type="button"
            onClick={() => { continueStationWithErpSession(); router.replace(STATION_HOME_PATH); }}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-[13px] border border-[color:var(--fo-control)] bg-surface px-4 text-[15px] font-semibold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('login.continueErp', { name: erpHint.name })}
          </button>
        ) : null}

        <p className="flex items-start gap-2 text-xs leading-5 text-muted">
          <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
          {t('login.sharedDevice')}
        </p>
      </form>
    </Shell>
  );
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return <p id={id} role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-negative"><CircleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />{children}</p>;
}

function FailureNotice({ failure }: { failure: LoginFailure }) {
  const t = useTranslations('stationOps');
  const Icon = failure === 'offline' ? WifiOff : CircleAlert;
  const soft = failure === 'throttled' || failure === 'offline' || failure === 'server';
  return (
    <div
      role="alert"
      data-login-failure={failure}
      className={`flex items-start gap-3 rounded-[14px] border border-border p-3.5 text-sm leading-6 ${soft ? 'bg-[color:var(--fo-warning-tint)] text-warning' : 'bg-[color:var(--fo-negative-tint)] text-negative'}`}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.9} />
      <p>{t(`login.failure.${failure}`)}</p>
    </div>
  );
}

/** الإطار: هيدر كحلي بهوية المنتج ثم جسم النموذج. بلا تنقل سفلي ولا سياق محطات (لم تُصادَق الجلسة بعد). */
function Shell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('stationOps');
  return (
    <div data-fuel-ops="" className="fo-root min-h-screen bg-background text-text [min-height:100dvh]">
      <header className="bg-[var(--fo-navy)] px-5 pb-10 text-[color:var(--fo-on-navy)] [padding-top:max(2rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex max-w-md flex-col items-center text-center">
          <span aria-hidden="true" className="grid h-16 w-16 place-items-center rounded-[18px] bg-[var(--fo-accent)] text-[color:var(--fo-navy)]">
            <Fuel className="h-8 w-8" strokeWidth={1.9} />
          </span>
          <h1 className="mt-4 text-2xl font-bold leading-8">{t('productName')}</h1>
          <p className="mt-1 text-sm text-[color:var(--fo-on-navy-muted)]">{t('login.subtitle')}</p>
        </div>
      </header>
      <main className="-mt-4 rounded-t-[22px] bg-background pt-8 [padding-bottom:max(1rem,env(safe-area-inset-bottom))]">{children}</main>
    </div>
  );
}

/**
 * نطاق اعتماد تطبيق المحطات مقابل أَوْج (STATION-PIN) — وحدة مستقلة بلا اعتماديات، يستوردها `api.ts` و`auth.ts` معاً.
 * منفصلة عن `api.ts` عمداً: اختبارات كثيرة تستبدل `@/lib/api` بنسخة جزئية، ويجب ألا تنكسر دوال النطاق بذلك.
 */
// مفاتيح مستقلة لاعتماد تطبيق «محطات أَوْج» (رقم الموظف + PIN) حتى لا يستبدل دخولُه جلسةَ ERP المفتوحة في المتصفح نفسه (ولا العكس):
//  • داخل مسارات التطبيق (`/fuel-stations/ops`) الاعتماد الفعّال = `station_token` فقط. جلسة أَوْج لا تُستعمل هناك إلا بموافقة صريحة
//    من المستخدم على شاشة الدخول (`station_use_erp = 1`)، ولا تُقرأ ضمناً — فلا يرث موظفٌ على جهاز مشترك هوية مدير سجّل دخول أَوْج.
//  • خارج التطبيق الاعتماد الفعّال = `token` فقط كما كان حرفياً؛ لا يرى جلسة المحطات إطلاقاً.
//  • الخروج/انتهاء الصلاحية/الاستبدال يمسّ مفاتيح نطاقه وحده. حدّ الخادم (`StationSessionBoundary`) لم يُمسّ.
export const STATION_TOKEN_KEY = 'station_token';
export const STATION_USER_KEY = 'station_user';
export const STATION_USE_ERP_KEY = 'station_use_erp';
export const STATION_APP_PREFIX = '/fuel-stations/ops';
export const STATION_LOGIN_PATH = '/fuel-stations/ops/login';

/** هل الصفحة الحالية ضمن تطبيق المحطات؟ (يحدّد أي مجموعة اعتماد تُستعمل). */
export function inStationApp(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location?.pathname;
  return typeof path === 'string' && (path === STATION_APP_PREFIX || path.startsWith(`${STATION_APP_PREFIX}/`));
}

export function getStationToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(STATION_TOKEN_KEY);
}

export function setStationToken(token: string): void {
  localStorage.setItem(STATION_TOKEN_KEY, token);
}

/**
 * هل وافق المستخدم صراحةً على استعمال جلسة أَوْج داخل التطبيق (للمدير الذي يدخل بالبريد)؟ الموافقة **مربوطة بمعرّف مستخدم أَوْج الذي وافق**:
 * إن تغيّر المستخدم المسجَّل في أَوْج (دخل آخر في تبويب آخر) أو زالت جلسته فلا تصحّ الموافقة، فلا تنتقل هوية جديدة إلى التطبيق بموافقة قديمة.
 */
export function stationUsesErpSession(): boolean {
  if (typeof window === 'undefined') return false;
  const approvedFor = localStorage.getItem(STATION_USE_ERP_KEY);
  if (!approvedFor || getErpToken() === null) return false;
  try {
    return (JSON.parse(localStorage.getItem('user') ?? 'null') as { id?: unknown } | null)?.id === approvedFor;
  } catch {
    return false;
  }
}

/** يمسح اعتماد المحطات وحده (توكن + مستخدم + موافقة استعمال أَوْج). جلسة أَوْج لا تُمسّ. */
export function clearStationSession(): void {
  localStorage.removeItem(STATION_TOKEN_KEY);
  localStorage.removeItem(STATION_USER_KEY);
  localStorage.removeItem(STATION_USE_ERP_KEY);
}

export function getErpToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

/** مفتاح المستخدم الفعّال في النطاق الحالي (للقراءة والكتابة). */
export function activeUserKey(): string {
  return inStationApp() && getStationToken() !== null ? STATION_USER_KEY : 'user';
}


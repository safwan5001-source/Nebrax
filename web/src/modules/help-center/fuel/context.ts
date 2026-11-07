import { getFuelHelpArticle, type FuelHelpArticle, type FuelHelpArticleSlug } from './index';

type Route = { kind: 'exact' | 'prefix'; pathname: `/${string}` } | { kind: 'regex'; pattern: RegExp };

export interface FuelContextRoute {
  context: string;
  articleSlug: FuelHelpArticleSlug;
  routes: readonly Route[];
}

const OPS = '/fuel-stations/ops';

/**
 * مصدر الحقيقة الوحيد لربط شاشات الوقود بالأدلة (تطبيق المحطات `/fuel-stations/ops/**` ووحدة ERP `/fuel-stations/**`).
 * الأنماط الأخص أولاً: أول تطابق يفوز. شاشة بلا دليل (عقود الشركات، AVI، الأجهزة) تعيد `undefined` فيذهب الزر إلى المركز.
 */
export const FUEL_CONTEXT_ROUTES = [
  // تطبيق المحطات
  { context: 'opsLogin', articleSlug: 'fuel-pin-login', routes: [{ kind: 'prefix', pathname: `${OPS}/login` }] },
  { context: 'opsOpenShift', articleSlug: 'fuel-open-shift', routes: [{ kind: 'exact', pathname: `${OPS}/shifts/open` }] },
  { context: 'opsReadings', articleSlug: 'fuel-meter-readings', routes: [{ kind: 'regex', pattern: /^\/fuel-stations\/ops\/shifts\/[^/]+\/readings(?:\/|$)/ }] },
  { context: 'opsHandover', articleSlug: 'fuel-handover-shift', routes: [{ kind: 'regex', pattern: /^\/fuel-stations\/ops\/shifts\/[^/]+\/handover$/ }] },
  { context: 'opsReview', articleSlug: 'fuel-review-approve-shift', routes: [{ kind: 'regex', pattern: /^\/fuel-stations\/ops\/shifts\/[^/]+\/review$/ }] },
  { context: 'opsShifts', articleSlug: 'fuel-shift-lifecycle', routes: [{ kind: 'prefix', pathname: `${OPS}/shifts` }] },
  { context: 'opsReceivingCosts', articleSlug: 'fuel-receiving-costs', routes: [{ kind: 'prefix', pathname: `${OPS}/receiving/costs` }] },
  { context: 'opsReceiving', articleSlug: 'fuel-receiving', routes: [{ kind: 'prefix', pathname: `${OPS}/receiving` }] },
  { context: 'opsTanks', articleSlug: 'fuel-tank-readings', routes: [{ kind: 'prefix', pathname: `${OPS}/tanks` }] },
  { context: 'opsReadingPolicy', articleSlug: 'fuel-tank-readings', routes: [{ kind: 'prefix', pathname: `${OPS}/manage/reading-policy` }] },
  { context: 'opsOpeningBalance', articleSlug: 'fuel-opening-balance', routes: [{ kind: 'prefix', pathname: `${OPS}/opening-balance` }] },
  { context: 'opsStaff', articleSlug: 'fuel-staff-access', routes: [{ kind: 'prefix', pathname: `${OPS}/manage` }] },
  { context: 'opsProducts', articleSlug: 'fuel-products-prices', routes: [{ kind: 'prefix', pathname: `${OPS}/products` }] },
  { context: 'opsProfile', articleSlug: 'fuel-app-quickstart', routes: [{ kind: 'prefix', pathname: `${OPS}/profile` }, { kind: 'prefix', pathname: `${OPS}/settings` }, { kind: 'exact', pathname: OPS }] },
  // وحدة المحطات في ERP
  { context: 'erpMasterData', articleSlug: 'fuel-tanks-pumps-nozzles', routes: [{ kind: 'prefix', pathname: '/fuel-stations/master-data' }] },
  { context: 'erpSettings', articleSlug: 'fuel-station-settings', routes: [{ kind: 'prefix', pathname: '/fuel-stations/settings' }] },
  { context: 'erpPrices', articleSlug: 'fuel-products-prices', routes: [{ kind: 'prefix', pathname: '/fuel-stations/prices' }] },
  { context: 'erpShifts', articleSlug: 'fuel-shift-lifecycle', routes: [{ kind: 'prefix', pathname: '/fuel-stations/shifts' }] },
  { context: 'erpSales', articleSlug: 'fuel-sales-invoicing', routes: [{ kind: 'prefix', pathname: '/fuel-stations/sales' }] },
  { context: 'erpReceiving', articleSlug: 'fuel-receiving', routes: [{ kind: 'prefix', pathname: '/fuel-stations/receiving' }] },
  {
    context: 'erpOversight',
    articleSlug: 'fuel-reports-monitoring',
    routes: [
      { kind: 'exact', pathname: '/fuel-stations' },
      { kind: 'prefix', pathname: '/fuel-stations/alerts' },
      { kind: 'prefix', pathname: '/fuel-stations/readiness' },
      { kind: 'prefix', pathname: '/fuel-stations/maintenance' },
      { kind: 'prefix', pathname: '/fuel-stations/safety' },
    ],
  },
] as const satisfies readonly FuelContextRoute[];

function normalize(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] || '/';
  return path === '/' ? path : path.replace(/\/+$/, '');
}

function matches(pathname: string, route: Route): boolean {
  if (route.kind === 'regex') return route.pattern.test(pathname);
  if (route.kind === 'exact') return pathname === route.pathname;
  return pathname === route.pathname || pathname.startsWith(`${route.pathname}/`);
}

export function resolveFuelContextualHelp(pathname: string): { context: string; article: FuelHelpArticle } | undefined {
  const normalized = normalize(pathname);
  const entry = FUEL_CONTEXT_ROUTES.find((candidate) => candidate.routes.some((route) => matches(normalized, route)));
  if (!entry) return undefined;
  const article = getFuelHelpArticle(entry.articleSlug);
  return article ? { context: entry.context, article } : undefined;
}

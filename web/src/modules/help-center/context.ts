import { getHelpArticle, type HelpArticle, type HelpArticleSlug } from './content';

type HelpRoutePattern = {
  kind: 'exact' | 'prefix';
  pathname: `/${string}`;
  excludedPathnames?: readonly `/${string}`[];
};

export type HelpContextKey =
  | 'dashboard'
  | 'branches'
  | 'salesInvoices'
  | 'customerPayments'
  | 'purchaseInvoices'
  | 'products'
  | 'stocktaking'
  | 'journals'
  | 'periodLocks'
  | 'posStart'
  | 'partners'
  | 'salesQuotes'
  | 'deliveryNotes'
  | 'inventoryOpenings'
  | 'stockPermits'
  | 'expenses'
  | 'fiscalYears';

export interface ContextualHelpRoute {
  context: HelpContextKey;
  articleSlug: HelpArticleSlug;
  routes: readonly HelpRoutePattern[];
}

/**
 * مصدر الحقيقة الوحيد لربط شاشات أَوْج بمقالات مركز المساعدة.
 * لا تحتوي المكونات على شروط مسارات، ولا تنشئ هذه الخريطة محتوى مساعدة جديداً.
 */
export const CONTEXTUAL_HELP_ROUTES = [
  { context: 'dashboard', articleSlug: 'first-steps', routes: [{ kind: 'exact', pathname: '/dashboard' }] },
  { context: 'branches', articleSlug: 'switch-active-branch', routes: [{ kind: 'prefix', pathname: '/branches' }] },
  { context: 'salesInvoices', articleSlug: 'create-sales-invoice', routes: [{ kind: 'prefix', pathname: '/invoices' }] },
  { context: 'customerPayments', articleSlug: 'record-customer-payment', routes: [{ kind: 'prefix', pathname: '/payments' }] },
  { context: 'purchaseInvoices', articleSlug: 'record-purchase-invoice', routes: [{ kind: 'prefix', pathname: '/purchases' }] },
  { context: 'products', articleSlug: 'create-product', routes: [{ kind: 'prefix', pathname: '/products' }] },
  { context: 'stocktaking', articleSlug: 'run-stocktake', routes: [{ kind: 'prefix', pathname: '/stocktaking' }] },
  {
    context: 'journals',
    articleSlug: 'manual-journal-entry',
    routes: [
      { kind: 'prefix', pathname: '/manual-journals' },
      { kind: 'prefix', pathname: '/journal-entries' },
    ],
  },
  {
    context: 'periodLocks',
    articleSlug: 'period-locks',
    routes: [{ kind: 'prefix', pathname: '/accounting-settings/period-locks' }],
  },
  { context: 'posStart', articleSlug: 'pos-session-and-sale', routes: [{ kind: 'exact', pathname: '/pos/start' }] },
  {
    context: 'partners',
    articleSlug: 'create-partner',
    routes: [
      { kind: 'exact', pathname: '/partners' },
      { kind: 'exact', pathname: '/partners/new' },
    ],
  },
  { context: 'salesQuotes', articleSlug: 'create-sales-quote', routes: [{ kind: 'prefix', pathname: '/quotes' }] },
  { context: 'deliveryNotes', articleSlug: 'delivery-notes', routes: [{ kind: 'prefix', pathname: '/delivery-notes' }] },
  {
    context: 'inventoryOpenings',
    articleSlug: 'import-inventory-opening',
    routes: [{ kind: 'prefix', pathname: '/inventory-openings' }],
  },
  { context: 'stockPermits', articleSlug: 'stock-permits', routes: [{ kind: 'prefix', pathname: '/stock-permits' }] },
  {
    context: 'expenses',
    articleSlug: 'record-expense',
    routes: [{ kind: 'prefix', pathname: '/expenses', excludedPathnames: ['/expenses/categories'] }],
  },
  {
    context: 'fiscalYears',
    articleSlug: 'fiscal-year-close',
    routes: [{ kind: 'prefix', pathname: '/accounting-settings/fiscal-years' }],
  },
] as const satisfies readonly ContextualHelpRoute[];

export interface ResolvedContextualHelp {
  context: HelpContextKey;
  article: HelpArticle;
}

function normalizePathname(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] || '/';
  if (path === '/') return path;
  return path.replace(/\/+$/, '');
}

function matchesRoute(pathname: string, route: HelpRoutePattern): boolean {
  if (route.excludedPathnames?.some((excluded) => pathname === excluded || pathname.startsWith(`${excluded}/`))) {
    return false;
  }
  if (route.kind === 'exact') return pathname === route.pathname;
  return pathname === route.pathname || pathname.startsWith(`${route.pathname}/`);
}

export function resolveContextualHelp(pathname: string): ResolvedContextualHelp | undefined {
  const normalized = normalizePathname(pathname);
  const match = CONTEXTUAL_HELP_ROUTES.find((entry) => entry.routes.some((route) => matchesRoute(normalized, route)));
  if (!match) return undefined;

  const article = getHelpArticle(match.articleSlug);
  return article ? { context: match.context, article } : undefined;
}

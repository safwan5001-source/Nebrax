import { OPS_BASE, RECEIVING_PERMISSIONS } from '../nav';

/**
 * AWJ Smart Guide — تعريف الجولات (بيانات فقط، بلا منطق عرض). تطبيق «محطات أَوْج» وحده؛ لا يُستورد من وحدة ERP.
 *
 * قواعد التعريف (يحرسها `tours.test.ts`):
 *  - كل خطوة تشير إلى **عنصر حقيقي** بمحدِّد CSS يستند إلى سمات/معرّفات موجودة فعلاً في المصدر (لا شرح لما ليس في الشاشة).
 *  - الصلاحيات تُرشِّح الخطوات؛ وعنصر غير موجود/مخفي في DOM يُتخطّى وقت التشغيل (قائمة الورديات تُخفي ما لا يُسمح به أصلاً).
 *  - الجولة لا تضغط ولا ترسل شيئاً: توضح فقط. نصوصها في `stationOps.guide.tour.<id>`.
 */
export type TourId = 'welcome' | 'shifts' | 'sales' | 'collection' | 'stock';

export interface TourStep {
  id: string;
  /** محدِّد CSS للعنصر المُبرَز؛ غيابه = بطاقة وسطية بلا Spotlight. */
  target?: string;
  /** كل هذه الصلاحيات مطلوبة معاً لتظهر الخطوة. */
  requires?: readonly string[];
  /** يكفي واحدة منها. */
  requiresAny?: readonly string[];
}

export interface Tour {
  id: TourId;
  /** يرتفع عند تغيّر محتوى الجولة جوهرياً، فتُعرض من جديد لمن أكملها بنسخة أقدم. */
  version: number;
  /** الشاشة التي تعمل عليها الجولة. */
  route: RegExp;
  /** رابط ثابت داخل التطبيق يصل إلى شاشة الجولة؛ `dynamic` = الشاشة نفسها تحتاج معرّفاً (وردية) فلا تُشغَّل من المركز مباشرة. */
  entry: `/${string}`;
  dynamic: boolean;
  /** صلاحيات ظهور الجولة كلها (وإلا لا تُعرض ولا تُشرح). */
  requires: readonly string[];
  /** تبدأ تلقائياً عند أول دخول للمستخدم. */
  auto?: boolean;
  steps: readonly TourStep[];
}

const NAV = 'nav[aria-label]';

export const TOURS: readonly Tour[] = [
  {
    id: 'welcome',
    version: 1,
    route: new RegExp(`^${OPS_BASE}$`),
    entry: OPS_BASE,
    dynamic: false,
    requires: ['fuel_stations.view'],
    auto: true,
    steps: [
      { id: 'intro' },
      { id: 'station', target: '#fo-station' },
      { id: 'nextStep', target: '[data-next-step]' },
      { id: 'primaryAction', target: '[data-primary-action]' },
      { id: 'products', target: 'section[aria-labelledby="fo-products-h"]' },
      { id: 'nav', target: NAV },
      { id: 'help', target: '[data-guide="help-button"]' },
      { id: 'done' },
    ],
  },
  {
    id: 'shifts',
    version: 1,
    route: new RegExp(`^${OPS_BASE}/shifts$`),
    entry: `${OPS_BASE}/shifts`,
    dynamic: false,
    requires: ['fuel_stations.view', 'fuel.shift.view'],
    steps: [
      { id: 'filters', target: 'main [role="group"][aria-label]' },
      { id: 'card', target: 'main ul > li:first-child' },
      { id: 'howToOpen', requires: ['fuel.shift.open'] },
    ],
  },
  {
    id: 'sales',
    version: 1,
    route: new RegExp(`^${OPS_BASE}/products$`),
    entry: `${OPS_BASE}/products`,
    dynamic: false,
    requires: ['fuel_stations.view'],
    steps: [
      { id: 'dispensable', target: 'section[aria-labelledby="fo-dispensable-h"]' },
      { id: 'price', target: 'section[aria-labelledby="fo-dispensable-h"] ul > li:first-child', requires: ['fuel.sale.view'] },
      { id: 'pumps', target: 'section[aria-labelledby="fo-pumps-h"]' },
      { id: 'tanks', target: 'section[aria-labelledby="fo-tanks-h"]' },
      { id: 'salesFromMeters' },
    ],
  },
  {
    id: 'collection',
    version: 1,
    route: new RegExp(`^${OPS_BASE}/shifts/[^/]+/handover$`),
    entry: `${OPS_BASE}/shifts`,
    dynamic: true,
    requires: ['fuel_stations.view', 'fuel.shift.close'],
    steps: [
      { id: 'readiness', target: '[data-readiness]' },
      { id: 'cashMovement', target: '[data-open-movement]' },
      { id: 'variance', target: '[data-variance-preview]' },
      { id: 'collectionEntry', target: '[data-collection-entry]' },
      { id: 'network', target: '[data-network-blocked]' },
      { id: 'confirm', target: '[data-confirm-close]' },
    ],
  },
  {
    id: 'stock',
    version: 1,
    route: new RegExp(`^${OPS_BASE}/tanks$`),
    entry: `${OPS_BASE}/tanks`,
    dynamic: false,
    requires: ['fuel_stations.view'],
    steps: [
      { id: 'levels', target: '[data-review-summary]' },
      { id: 'tank', target: 'main ul > :first-child' },
      { id: 'receiving', target: `${NAV} a[href="${OPS_BASE}/receiving"]`, requiresAny: RECEIVING_PERMISSIONS },
      { id: 'recordReading' },
    ],
  },
];

export function getTour(id: string): Tour | undefined {
  return TOURS.find((tour) => tour.id === id);
}

export function tourForPathname(pathname: string): Tour | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return TOURS.find((tour) => tour.route.test(path));
}

/** هل يحقّ للمستخدم رؤية هذه الجولة أصلاً؟ (الصلاحيات فقط؛ وجود العناصر يُحسم وقت التشغيل). */
export function tourAvailable(tour: Tour, can: (permission: string) => boolean): boolean {
  return tour.requires.every((permission) => can(permission));
}

export function stepPermitted(step: TourStep, can: (permission: string) => boolean): boolean {
  return (step.requires ?? []).every((permission) => can(permission))
    && (step.requiresAny === undefined || step.requiresAny.some((permission) => can(permission)));
}

/**
 * رسائل مركز تنبيه الطلبات (ar/en) — COPS-H3-3. المفاتيح متطابقة بين اللغتين (يحرسه messages.test.ts).
 * **نصوص الموثوقية ملزمة** (ADR-30 §5.3): ممنوع أي صياغة تَعِد بـ«لن تفوتك طلبات» أو بالعمل في الخلفية/على الجوال المقفل (يحرس ذلك الاختبار).
 */
const ar = {
  bellLabel: 'تنبيهات الطلبات',
  bellLabelPending: 'تنبيهات الطلبات — طلبات بانتظارك',
  panelTitle: 'تنبيهات طلبات المتجر',
  emptyTitle: 'لا طلبات تنتظر الانتباه الآن',
  emptyHint: 'تظهر هنا الطلبات الجديدة التي لم تُقبل ولم يبدأ تنفيذها بعد.',
  pendingCount: 'بانتظارك: {count}',
  open: 'فتح الطلب',
  ack: 'إقرار الطلب',
  acking: 'جارٍ الإقرار…',
  ackHint: 'يُسكت التنبيه على كل الأجهزة والمستخدمين، ولا يغيّر حالة الطلب ويبقى في قوائم العمل.',
  ackFailed: 'تعذّر إقرار الطلب. تحقق من الاتصال ثم حاول مرة أخرى.',
  truncated: 'هناك طلبات أكثر مما يمكن عرضه هنا. افتح قائمة الطلبات للاطلاع على الكل.',
  statusLive: 'متصل',
  statusConnecting: 'جارٍ الاتصال',
  statusDegraded: 'انقطاع مؤقت — نعيد المحاولة',
  statusOffline: 'لا يوجد اتصال بالشبكة',
  lastUpdate: 'آخر تحديث منذ {seconds} ث',
  stale: 'قد تتأخر التنبيهات: آخر اتصال ناجح كان قبل أكثر من 30 ثانية.',
  soundOn: 'الصوت مفعّل',
  soundOff: 'الصوت غير مفعّل',
  soundBarText: 'الصوت غير مفعّل على هذا الجهاز، فلن تسمع تنبيه الطلبات الجديدة.',
  soundEnable: 'تفعيل الصوت',
  soundTest: 'اختبار التنبيه',
  soundTestFailed: 'منع المتصفح تشغيل الصوت. اضغط «تفعيل الصوت» ثم جرّب مجدداً، وتحقق من مستوى صوت الجهاز وعدم تفعيل الكتم.',
  soundOwnerOther: 'الصوت يُشغَّل من تبويب آخر مفتوح على هذا الجهاز.',
  reliabilityOn: 'تصلك تنبيهات الطلبات الجديدة بينما تبقى هذه الصفحة مفتوحة. للحصول على الصوت، فعّله على هذا الجهاز.',
  reliabilityLimits: 'قد يتأخر التنبيه أو لا يصل إذا كانت الصفحة في الخلفية أو كان الجهاز مقفلاً.',
  warehouseScoped: 'تعرض هذه القائمة طلبات مخازنك فقط.',
  sectionAlerts: 'تنبيهات هذا الجهاز',
  'reason.new_order': 'طلب جديد',
  'reason.awaiting_acceptance': 'بانتظار القبول',
  'reason.due_for_preparation': 'حان وقت التحضير',
  'reason.fulfillment_not_started': 'لم يبدأ التنفيذ',
  'reason.delivery_failed': 'فشل التوصيل',
};

const en: Record<keyof typeof ar, string> = {
  bellLabel: 'Order alerts',
  bellLabelPending: 'Order alerts — orders need you',
  panelTitle: 'Store order alerts',
  emptyTitle: 'No orders need attention right now',
  emptyHint: 'New orders that have not been accepted and have not started fulfillment appear here.',
  pendingCount: 'Waiting: {count}',
  open: 'Open order',
  ack: 'Acknowledge order',
  acking: 'Acknowledging…',
  ackHint: 'Silences the alert on every device and user. It does not change the order status and the order stays in your work lists.',
  ackFailed: 'Could not acknowledge the order. Check the connection and try again.',
  truncated: 'More orders than can be shown here. Open the orders list to see them all.',
  statusLive: 'Connected',
  statusConnecting: 'Connecting',
  statusDegraded: 'Temporary interruption — retrying',
  statusOffline: 'No network connection',
  lastUpdate: 'Updated {seconds}s ago',
  stale: 'Alerts may be delayed: the last successful connection was over 30 seconds ago.',
  soundOn: 'Sound on',
  soundOff: 'Sound off',
  soundBarText: 'Sound is not enabled on this device, so you will not hear new-order alerts.',
  soundEnable: 'Enable sound',
  soundTest: 'Test alert',
  soundTestFailed: 'The browser blocked the sound. Press "Enable sound" and try again, and check the device volume and mute switch.',
  soundOwnerOther: 'Sound plays from another tab open on this device.',
  reliabilityOn: 'New-order alerts reach you while this page stays open. Enable sound on this device to hear them.',
  reliabilityLimits: 'Alerts may be delayed or missed if this page is in the background or the device is locked.',
  warehouseScoped: 'This list shows orders for your warehouses only.',
  sectionAlerts: 'This device',
  'reason.new_order': 'New order',
  'reason.awaiting_acceptance': 'Awaiting acceptance',
  'reason.due_for_preparation': 'Time to prepare',
  'reason.fulfillment_not_started': 'Not started',
  'reason.delivery_failed': 'Delivery failed',
};

export const ALERT_MESSAGES = { ar, en } as const;
export type AlertMessageKey = keyof typeof ar;

export function alertMessages(locale: string) {
  const dict: Record<AlertMessageKey, string> = locale === 'en' ? en : ar;
  const t = (key: AlertMessageKey, vars?: Record<string, string | number>): string => {
    let text = dict[key];
    for (const [k, v] of Object.entries(vars ?? {})) text = text.replace(`{${k}}`, String(v));

    return text;
  };
  /** سبب خادم غير معروف يُعرض حرفياً ولا تُخترع له ترجمة. */
  const reason = (value: string): string => {
    const key = `reason.${value}` as AlertMessageKey;

    return key in dict ? dict[key] : value;
  };

  return { t, reason };
}

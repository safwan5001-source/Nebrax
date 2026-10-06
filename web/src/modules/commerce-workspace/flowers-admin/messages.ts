/**
 * FLOWERS Horizon 2 — نصوص شاشات إدارة التاجر. حزمة مستقلة عن `commerce-workspace/messages.ts`
 * (التي تحمل التنقل والمتاجر) كي لا تتضخّم؛ اختبار التكافؤ يضمن أن كل مفتاح عربي له إنجليزي.
 * القيم المتغيّرة بصيغة `{name}` وتُستبدل في `flowersAdminMessage`.
 */
export const FLOWERS_ADMIN_MESSAGES = {
  ar: {
    // مشترك
    save: 'حفظ',
    saving: 'جارٍ الحفظ…',
    discard: 'تراجع عن التعديلات',
    unsaved: 'تغييرات غير محفوظة',
    allSaved: 'كل التعديلات محفوظة',
    retry: 'إعادة المحاولة',
    loading: 'جارٍ التحميل…',
    forbidden: 'لا تملك صلاحية عرض أو إدارة هذه الإعدادات. اطلب من مالك الحساب صلاحية إدارة التجارة الإلكترونية.',
    notFound: 'هذا المتجر غير متاح. اختر متجراً آخر من القائمة.',
    saveFailed: 'تعذّر الحفظ. لم يتغيّر شيء، حاول مجدداً.',
    loadFailed: 'تعذّر تحميل الإعدادات. حاول مجدداً.',
    // الإهداء — H2-1
    giftTitle: 'الإهداء',
    giftDescription: 'ما الذي يطلبه متجرك ممّن يشتري هدية: رسالة بطاقة، إخفاء اسم المُرسل، وبيانات المُهدى إليه عند الدفع.',
    giftSectionTitle: 'سياسة الإهداء',
    giftSectionHint: 'تخصّ هذا المتجر وحده. لا يُفعَّل شيء تلقائياً — أنت من يقرّر.',
    giftEnabledLabel: 'تفعيل الإهداء',
    giftEnabledHint: 'تظهر للمتسوّق خطوة اختيارية «الإهداء» أثناء الدفع: بيانات المُهدى إليه ورسالة البطاقة.',
    giftLengthLabel: 'الحد الأقصى لطول الرسالة',
    giftLengthHint: 'عدد الأحرف المسموح بها في بطاقة الإهداء، من 1 إلى {max}.',
    giftLengthUnit: 'حرف',
    giftLengthInvalid: 'أدخل عدداً صحيحاً بين 1 و{max}.',
    giftHideSenderLabel: 'السماح بإخفاء اسم المُرسل',
    giftHideSenderHint: 'يستطيع المتسوّق إرسال الهدية دون أن يظهر اسمه على البطاقة.',
    giftPhoneLabel: 'جوال المُهدى إليه إلزامي',
    giftPhoneHint: 'يُطلب الرقم لتنسيق التسليم. عند الإيقاف يصبح اختيارياً.',
    giftOffNote: 'الإهداء موقوف: تبقى القيم أدناه محفوظة ولن يراها المتسوّق حتى تفعّله.',
    giftSummaryTitle: 'ما سيراه المتسوّق',
    giftSummaryOff: 'لا تظهر خطوة الإهداء؛ يتم الطلب كالمعتاد.',
    giftSummaryOn: 'تظهر خطوة «الإهداء» اختيارياً أثناء الدفع.',
    giftSummaryLength: 'رسالة البطاقة حتى {n} حرفاً.',
    giftSummaryHideOn: 'يمكنه إخفاء اسمه عن المُهدى إليه.',
    giftSummaryHideOff: 'خيار إخفاء الاسم لا يُعرض للمتسوّق.',
    giftSummaryPhoneOn: 'جوال المُهدى إليه مطلوب.',
    giftSummaryPhoneOff: 'جوال المُهدى إليه اختياري.',
    giftSaved: 'تم حفظ سياسة الإهداء',
  },
  en: {
    save: 'Save',
    saving: 'Saving…',
    discard: 'Discard changes',
    unsaved: 'Unsaved changes',
    allSaved: 'All changes saved',
    retry: 'Try again',
    loading: 'Loading…',
    forbidden: 'You do not have permission to view or manage these settings. Ask the account owner for the e-commerce management permission.',
    notFound: 'This store is not available. Pick another store from the list.',
    saveFailed: 'Could not save. Nothing changed — try again.',
    loadFailed: 'Could not load the settings. Try again.',
    giftTitle: 'Gifting',
    giftDescription: 'What your store asks of someone buying a gift: a card message, hiding the sender name, and the recipient details at checkout.',
    giftSectionTitle: 'Gift policy',
    giftSectionHint: 'Applies to this store only. Nothing is switched on automatically — it is your decision.',
    giftEnabledLabel: 'Enable gifting',
    giftEnabledHint: 'Shoppers see an optional “Gift” step at checkout: recipient details and a card message.',
    giftLengthLabel: 'Maximum message length',
    giftLengthHint: 'Characters allowed on the gift card, from 1 to {max}.',
    giftLengthUnit: 'characters',
    giftLengthInvalid: 'Enter a whole number between 1 and {max}.',
    giftHideSenderLabel: 'Allow hiding the sender name',
    giftHideSenderHint: 'Shoppers can send the gift without their name appearing on the card.',
    giftPhoneLabel: 'Recipient phone is required',
    giftPhoneHint: 'The number is used to coordinate delivery. When off, it becomes optional.',
    giftOffNote: 'Gifting is off: the values below stay saved and shoppers will not see them until you turn it on.',
    giftSummaryTitle: 'What shoppers will see',
    giftSummaryOff: 'No gift step appears; checkout works as usual.',
    giftSummaryOn: 'An optional “Gift” step appears at checkout.',
    giftSummaryLength: 'Card message up to {n} characters.',
    giftSummaryHideOn: 'They can hide their name from the recipient.',
    giftSummaryHideOff: 'The option to hide the sender name is not offered.',
    giftSummaryPhoneOn: 'The recipient phone is required.',
    giftSummaryPhoneOff: 'The recipient phone is optional.',
    giftSaved: 'Gift policy saved',
  },
} as const;

export type FlowersAdminMessageKey = keyof typeof FLOWERS_ADMIN_MESSAGES.ar;
export type FlowersAdminT = (key: FlowersAdminMessageKey, vars?: Record<string, string | number>) => string;

export function flowersAdminMessage(
  locale: string | undefined,
  key: FlowersAdminMessageKey,
  vars?: Record<string, string | number>,
): string {
  const pack = locale?.startsWith('en') ? FLOWERS_ADMIN_MESSAGES.en : FLOWERS_ADMIN_MESSAGES.ar;
  const template: string = pack[key];
  if (!vars) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function flowersAdminT(locale: string | undefined): FlowersAdminT {
  return (key, vars) => flowersAdminMessage(locale, key, vars);
}

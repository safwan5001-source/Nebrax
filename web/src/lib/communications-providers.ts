/**
 * سجل عرض «مزودو الاتصالات» (AWJ-COMMS-UX-01) — منطق نقيّ بلا شبكة ولا حالة مستأجر.
 *
 * هذا السجل **وصف لما هو معروف**، لا قائمة مزوّدين معتمدين ولا نموذج اتصال. لا يوجد في
 * النظام اليوم أي مزوّد اتصالات فعلي: `OtpProvider` مربوط بـ`FakeOtpProvider` الذي لا يرسل
 * رسالة حقيقية (app/Services/Commerce/Otp)، واختيار أي مزوّد SMS/رسائل مدفوع قرارٌ مالكٌ
 * منفصل لم يُتخذ (docs/autonomous-engineering/TASK-QUEUE.md، «Messaging Foundation flag»).
 *
 * لذلك حالة المزوّد هنا **ثلاث فقط** (`ProviderStatus`) و«متصل فعلًا» ليس قيمةً في النوع أصلاً:
 * لا يمكن لسطر في هذا السجل أن يُعلَن متصلاً أو مفعّلاً. إن بُني يوماً مسار اتصال حقيقي، تأتي حالته
 * من قراءة خادمية مُثبَتة (كسُلّم منصات التوصيل) لا من تعديل هذا الملف.
 *
 * الشعارات: لا يُستعمل إلا أصل رسمي موجود في المستودع أو مرخّص صراحةً. عند غياب الأصل تُعرض
 * أيقونة القناة العامة، ويُوثَّق سبب الغياب في `logo.gap` (يفحصه اختبار: لا مزوّد بلا شعار ولا سبب).
 */

export type CommunicationChannelKey = 'sms' | 'whatsapp' | 'email' | 'push';

/**
 * - `theoretical`: مزوّد معروف التوثيق العام، لا التزام ولا محوّل في أَوْج.
 * - `planned`: مذكور في خطط أَوْج المعتمدة كهدف، بلا محوّل مبني.
 * - `owner_approval`: مرشّح مذكور في قرارات أَوْج، واختياره بانتظار قرار المالك (Owner Gate).
 */
export type ProviderStatus = 'theoretical' | 'planned' | 'owner_approval';

export const PROVIDER_STATUS_ORDER: readonly ProviderStatus[] = ['theoretical', 'planned', 'owner_approval'];

export type ProviderLogo =
  | {
      kind: 'official';
      /** أصل ثابت داخل `web/public` — لا رابط خارجي ولا تحميل وقت التشغيل. */
      src: string;
      /** من أين جاء الأصل ومن أي رخصة/سياسة، كما وُثّق في المستودع. */
      source: string;
      license: string;
    }
  | {
      kind: 'generic';
      /** لماذا لا يوجد أصل رسمي مُستعمل، بدقّة ما فُحص وما لم يُفحص. */
      gap: string;
    };

export interface CommunicationProvider {
  /** مفتاح ثابت للواجهة والاختبارات (ليس مفتاح API ولا مرجع حساب). */
  key: string;
  channel: CommunicationChannelKey;
  /** الاسم التجاري كما ينشره صاحبه، بلا ترجمة. */
  name: string;
  /** الجهة المالكة كما تنشرها. */
  vendor: string;
  status: ProviderStatus;
  /** دليل الهوية: صفحة المزوّد الرسمية التي تثبت وجوده وفئته (لا تُعرض في الواجهة). */
  identityUrl: string;
  /** دليل الحالة داخل أَوْج حيث تتجاوز `theoretical`. */
  awjEvidence: string | null;
  logo: ProviderLogo;
}

export const COMMUNICATION_CHANNEL_ORDER: readonly CommunicationChannelKey[] = ['sms', 'whatsapp', 'email', 'push'];

/** شعار WhatsApp الرسمي موجود في المستودع منذ تذييل المتجر؛ يُعاد استعماله بايتاً ببايت. */
const WHATSAPP_OFFICIAL_LOGO: ProviderLogo = {
  kind: 'official',
  src: '/brand/social/whatsapp.svg',
  source: "WhatsApp Brand Resource Center — Digital_Glyph_Green_RGB_2026.svg (web/public/brand/social/whatsapp.svg، غير معدَّل؛ موثّق في OfficialSocialMark.tsx)",
  license: 'شروط WhatsApp Brand Resource Center (مواد علامة منشورة من صاحبها للاستعمال وفق إرشاداته؛ ليست رخصة مفتوحة)',
};

export const COMMUNICATION_PROVIDERS: readonly CommunicationProvider[] = [
  {
    key: 'unifonic',
    channel: 'sms',
    name: 'Unifonic',
    vendor: 'Unifonic',
    status: 'owner_approval',
    identityUrl: 'https://www.unifonic.com/',
    awjEvidence: 'app/Services/Commerce/Otp/OtpProvider.php؛ docs/autonomous-engineering/TASK-QUEUE.md (مرشّح مستقبلي، وقرار منفصل للمالك)',
    logo: { kind: 'generic', gap: 'لم يوجد مجموعة علامة/Press kit رسمية منشورة تُثبت الملفات ورخصتها؛ أيقونة التطبيق في App Store تخص منتجاً آخر (AgentApp). مطلوب طلب الأصل من Unifonic.' },
  },
  {
    key: 'twilio-sms',
    channel: 'sms',
    name: 'Twilio Messaging',
    vendor: 'Twilio Inc.',
    status: 'theoretical',
    identityUrl: 'https://www.twilio.com/docs/messaging',
    awjEvidence: null,
    logo: { kind: 'generic', gap: 'سياسة Twilio للعلامة لا تمنح استعمال الشعارات إلا بإذن كتابي من إدارتها القانونية (ما عدا شارة «Powered by Twilio» بشروطها).' },
  },
  {
    key: 'whatsapp-business-platform',
    channel: 'whatsapp',
    name: 'WhatsApp Business Platform',
    vendor: 'Meta Platforms',
    status: 'planned',
    identityUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
    awjEvidence: 'docs/commerce/AWJ_GROWTH_PLATFORM_V1.md §7 (منصة الاتصالات) والمرحلة 6',
    logo: WHATSAPP_OFFICIAL_LOGO,
  },
  {
    key: 'amazon-ses',
    channel: 'email',
    name: 'Amazon SES',
    vendor: 'Amazon Web Services',
    status: 'theoretical',
    identityUrl: 'https://aws.amazon.com/ses/',
    awjEvidence: null,
    logo: { kind: 'generic', gap: 'سياسة علامات AWS تحصر الترخيص بشارة «Powered by AWS» لعملاء الخدمة؛ لم يُحصل على أصل أيقونة SES ولا إذن باستعماله في واجهة منتج.' },
  },
  {
    key: 'postmark',
    channel: 'email',
    name: 'Postmark',
    vendor: 'ActiveCampaign (Postmark)',
    status: 'theoretical',
    identityUrl: 'https://postmarkapp.com/',
    awjEvidence: null,
    logo: { kind: 'generic', gap: 'لم تُحدَّد مجموعة علامة رسمية منشورة؛ لم يُحصل على أصل. مطلوب طلبه من المزوّد.' },
  },
  {
    key: 'firebase-cloud-messaging',
    channel: 'push',
    name: 'Firebase Cloud Messaging',
    vendor: 'Google',
    status: 'theoretical',
    identityUrl: 'https://firebase.google.com/docs/cloud-messaging',
    awjEvidence: null,
    logo: { kind: 'generic', gap: 'إرشادات علامة Firebase تمنع استعمال الشعار القياسي داخل منتج وتقيّد أيقونات المنتج؛ لم يُستعمل أي أصل.' },
  },
  {
    key: 'apple-push-notification-service',
    channel: 'push',
    name: 'Apple Push Notification service (APNs)',
    vendor: 'Apple',
    status: 'theoretical',
    identityUrl: 'https://developer.apple.com/documentation/usernotifications',
    awjEvidence: null,
    logo: { kind: 'generic', gap: 'لا تنشر Apple شعاراً مستقلاً لخدمة APNs؛ شعار Apple نفسه لا يُستعمل للدلالة على خدمة طرف ثالث.' },
  },
];

const BY_KEY = new Map(COMMUNICATION_PROVIDERS.map((provider) => [provider.key, provider]));

export function communicationProvider(key: string | null | undefined): CommunicationProvider | null {
  return key ? BY_KEY.get(key) ?? null : null;
}

export function providersByChannel(channel: CommunicationChannelKey): CommunicationProvider[] {
  return COMMUNICATION_PROVIDERS.filter((provider) => provider.channel === channel);
}

/** من يملك رؤية الكتالوج: قرار اختيار مزوّد اتصالات للمالك/المدير (`company.manage`). الكتالوج ثابت ولا يقرأ بيانات مستأجر. */
export const COMMUNICATIONS_PERMISSION = 'company.manage';

export const COMMUNICATIONS_CATALOG_HREF = '/integrations/communications';

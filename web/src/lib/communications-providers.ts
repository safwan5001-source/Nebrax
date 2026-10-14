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
 * الشعارات: لا يُستعمل إلا أصل رسمي نشره صاحبه (موقعه أو حزمة علامته)، محفوظٌ محلياً **بايتاً ببايت**
 * (`sha256` يفحصه اختبار فلا يمكن تعديله بصمت). لا رسم ولا تلوين ولا قصّ ولا تحميل خارجي وقت التشغيل.
 * عند غياب أصل يجوز استعماله تُعرض أيقونة القناة العامة، ويُوثَّق السبب باسم المزود في `logo.gap`
 * (يفحصه اختبار: لا مزوّد بلا شعار موثّق أو سبب موثّق). قيود الاستعمال المعروفة لكل أصل في `logo.restrictions`.
 */

export type CommunicationChannelKey = 'sms' | 'whatsapp' | 'email' | 'push';

/**
 * كلها «خيارات مستقبلية» لا اتصال فيها ولا إرسال ولا اختبار على API حقيقي ولا اعتماد تجاري:
 * - `theoretical`: مزوّد معروف التوثيق العام، لا التزام ولا محوّل في أَوْج.
 * - `planned`: مذكور في خطط أَوْج المعتمدة كهدف، بلا محوّل مبني.
 * - `owner_approval`: مرشّح مستقبلي حدّده المالك أو قرارات أَوْج، واختياره بانتظار موافقة المالك (Owner Gate).
 */
export type ProviderStatus = 'theoretical' | 'planned' | 'owner_approval';

export const PROVIDER_STATUS_ORDER: readonly ProviderStatus[] = ['theoretical', 'planned', 'owner_approval'];

export type ProviderLogo =
  | {
      kind: 'official';
      /** أصل ثابت داخل `web/public` — لا رابط خارجي ولا تحميل وقت التشغيل. */
      src: string;
      /** SHA-256 للبايتات المحفوظة: يثبت أنها كما نشرها صاحبها (يفحصه اختبار). */
      sha256: string;
      /** الأبعاد الطبيعية (viewBox أو بكسلات) لحجز المساحة دون تشويه النسبة. */
      width: number;
      height: number;
      /** `square` ≈ أيقونة تملأ خانة 32px؛ `wide` شعار أفقي يُعرض بارتفاع 32px وعرضه الطبيعي. */
      shape: 'square' | 'wide';
      /** `light`: شعار داكن/شفاف يحتاج حاملاً فاتحاً ليُقرأ في الوضع الداكن (لا يُلوَّن الشعار نفسه). */
      backing: 'none' | 'light';
      /** من أين جاء الأصل بالضبط (صفحة/رابط المالك)، وتاريخ الجلب. */
      source: string;
      /** قيود الاستعمال المعروفة كما نشرها المالك، أو أنه لم تُنشر سياسة ويلزم تأكيد كتابي. */
      restrictions: string;
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
  sha256: 'f7b1311db718533e671645f57cd94b92f0e006e61d7e6581a80675fc5a478fc4',
  width: 720,
  height: 720,
  shape: 'square',
  backing: 'none',
  source: 'WhatsApp Brand Resource Center — Digital_Glyph_Green_RGB_2026.svg (موجود سابقاً في web/public/brand/social/whatsapp.svg، موثّق في OfficialSocialMark.tsx)',
  restrictions: 'شروط WhatsApp Brand Resource Center: مواد علامة للاستعمال وفق إرشاداتها لتعريف الخدمة، دون إيحاء بشراكة أو رعاية؛ ليست رخصة مفتوحة.',
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
    logo: {
      kind: 'official',
      src: '/comms-providers/unifonic.png',
      sha256: '718d67c93361da961e5c7987499de3d79cc172b78662390c66878023cf6e1bca',
      width: 2084,
      height: 2084,
      shape: 'square',
      backing: 'none',
      source: 'رمز Unifonic الدائري الأخضر (Favicon_Round_Green.png، 2084×2084) كما يخدمه موقعها الرسمي https://www.unifonic.com/hubfs/Favicon_Round_Green.png — جُلب 2026-10-14. لا يوجد Press kit منشور (/brand و/press تعيدان 404).',
      restrictions: 'لم تُنشر سياسة استعمال للعلامة؛ الأصل مأخوذ من موقعها الرسمي لا من حزمة علامة مرخّصة. يلزم تأكيد كتابي من Unifonic قبل أي إطلاق إنتاجي.',
    },
  },
  {
    key: 'taqnyat',
    channel: 'sms',
    name: 'Taqnyat (تقنيات)',
    vendor: 'Taqnyat',
    status: 'owner_approval',
    identityUrl: 'https://taqnyat.sa/en/channels/sms',
    awjEvidence: 'docs/plans/commerce/AWJ-COMMS-UX-01-IMPLEMENTATION-REPORT.md (تعليمات المالك 2026-10-14: مرشّح مستقبلي سعودي، غير متصل، بانتظار موافقته)',
    logo: {
      kind: 'official',
      src: '/comms-providers/taqnyat.svg',
      sha256: '41f4a2aff7d6c7c3c8e1c0b74523e8e3d39f1a72f0e37b8bd4b6b786ad2e1aaf',
      width: 314,
      height: 105,
      shape: 'wide',
      backing: 'light',
      source: 'الشعار الرئيسي LogoMain.svg (SVG أصلي، 314×105) كما يخدمه موقعها الرسمي https://taqnyat.sa/assets/images/LogoMain.svg — جُلب 2026-10-14.',
      restrictions: 'لم تُنشر سياسة استعمال للعلامة (/en/brand تعيد 404)؛ الأصل من موقعها الرسمي. يلزم تأكيد كتابي من تقنيات قبل أي إطلاق إنتاجي. ترخيص CST للمزود لم يُتحقق منه في هذه المهمة ولا يُدّعى.',
    },
  },
  {
    key: 'twilio-sms',
    channel: 'sms',
    name: 'Twilio Messaging',
    vendor: 'Twilio Inc.',
    status: 'theoretical',
    identityUrl: 'https://www.twilio.com/docs/messaging',
    awjEvidence: null,
    logo: {
      kind: 'generic',
      gap: 'الأصل الرسمي موجود (رمز/شعار على twilio.com) لكن سياسة Twilio (twilio.com/en-us/legal/logo-use) تنص على أنه «لا يجوز استعمال شعارها دون إذن كتابي صريح» من إدارتها القانونية (trademark@twilio.com)، والاستثناء الوحيد شارة «Powered by Twilio». لم يُشحن أي أصل حتى يصدر الإذن.',
    },
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
    logo: {
      kind: 'generic',
      gap: 'الأصل الرسمي موجود في حزمة AWS Architecture Icons لكنها مرخّصة «لإنشاء مخططات معمارية» فقط، وإرشادات AWS للعلامات (aws.amazon.com/trademark-guidelines §13 و§3(d)) تحصر الاستعمال العادل بالنص دون شعارات وتشترط إذناً كتابياً لما عداه. لم يُشحن أي أصل حتى يصدر الإذن.',
    },
  },
  {
    key: 'postmark',
    channel: 'email',
    name: 'Postmark',
    vendor: 'ActiveCampaign (Postmark)',
    status: 'theoretical',
    identityUrl: 'https://postmarkapp.com/',
    awjEvidence: null,
    logo: {
      kind: 'official',
      src: '/comms-providers/postmark.svg',
      sha256: 'be44c8d132657e19c0a1f43b4f31e7bfa27be327e8f8a2b5c9796281bb64758e',
      width: 30,
      height: 30,
      shape: 'square',
      backing: 'none',
      source: 'ختم Postmark (logo-stamp-simple.svg، SVG أصلي) كما يخدمه موقعها الرسمي https://postmarkapp.com/images/logo-stamp-simple.svg — جُلب 2026-10-14. لا صفحة علامة منشورة (/brand و/press تعيدان 404).',
      restrictions: 'لم تُنشر سياسة استعمال للعلامة؛ الأصل من موقعها الرسمي. يلزم تأكيد كتابي من Postmark قبل أي إطلاق إنتاجي.',
    },
  },
  {
    key: 'firebase-cloud-messaging',
    channel: 'push',
    name: 'Firebase Cloud Messaging',
    vendor: 'Google',
    status: 'theoretical',
    identityUrl: 'https://firebase.google.com/docs/cloud-messaging',
    awjEvidence: null,
    logo: {
      kind: 'official',
      src: '/comms-providers/firebase-cloud-messaging.svg',
      sha256: '9552833a2e10f171d48f6a2641884cd072ba0bf9982b34b91c8531e61c9c66c7',
      width: 132,
      height: 123,
      shape: 'square',
      backing: 'none',
      source: 'Product_Logomark_Cloud_Messaging_Full_Color.svg من حزمة Firebase Brand Assets الرسمية https://firebase.google.com/static/downloads/brand-guidelines/firebase-brand-assets.zip — جُلب 2026-10-14.',
      restrictions: 'إرشادات https://firebase.google.com/brand-guidelines: أيقونات المنتج للاستعمال حيث يتضح Firebase من السياق؛ لا يُقرن الشعار باسم تطبيقنا؛ لا يكون أبرز عنصر في الصفحة؛ لا يقل ارتفاعه عن 24px؛ لا إيحاء بتأييد من Firebase. الشعار القياسي (Lockup) محظور داخل المنتج ولا يُستعمل.',
    },
  },
  {
    key: 'apple-push-notification-service',
    channel: 'push',
    name: 'Apple Push Notification service (APNs)',
    vendor: 'Apple',
    status: 'theoretical',
    identityUrl: 'https://developer.apple.com/documentation/usernotifications',
    awjEvidence: null,
    logo: {
      kind: 'generic',
      gap: 'لا تنشر Apple شعاراً أو أيقونة مستقلة لخدمة APNs، وشعار Apple نفسه لا يُستعمل للدلالة على خدمة طرف ثالث أو للإيحاء بتأييد. لا أصل يمكن استعماله.',
    },
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

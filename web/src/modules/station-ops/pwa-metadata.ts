import type { Metadata, Viewport } from 'next';

/**
 * هوية التثبيت (PWA) لتطبيق «محطات أَوْج» — مصدر واحد لمجموعتَي المسارات `(fuel-ops)` و`(fuel-ops-auth)`.
 *
 * السبب: Chrome على Android لا يعرض «تثبيت التطبيق» (ولا يبني WebAPK) إلا بوجود manifest صالح بأيقونتَي PNG
 * 192 و512 و`start_url` داخل `scope` و`display` مستقل. iOS يقبل «إضافة إلى الشاشة الرئيسية» بلا manifest،
 * فكان النجاح هناك لا يدلّ على صحة الإعداد. الـmanifest ثابت في `public/` (بلا اعتماد على مضيف/مستأجر)، وأيقونات
 * التثبيت PNG ثابتة بدل `/api/company-browser-icon` (قد يعيد ico/تحويلاً/شعار مستأجر بصيغة غير صالحة للتثبيت).
 *
 * النطاق `/fuel-stations/ops` وحده، و`id` ثابت يفصل هوية هذا التطبيق عن أي تثبيت لأَوْج ERP على المضيف نفسه.
 */
export const STATION_OPS_MANIFEST_PATH = '/fuel-ops-pwa/manifest.webmanifest';

export const stationOpsPwaMetadata: Pick<Metadata, 'manifest' | 'icons'> = {
  manifest: STATION_OPS_MANIFEST_PATH,
  icons: {
    icon: [
      { url: '/fuel-ops-pwa/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/fuel-ops-pwa/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/fuel-ops-pwa/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const stationOpsViewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#142238',
};

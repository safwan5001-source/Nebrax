'use client';

import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { api, fetchImageUrl, getToken } from '@/lib/api';
import { findLogoContentBounds, hasMeaningfulLogoPixels } from './company-logo-quality';

type CompanyBrand = {
  logoUrl: string | null;
  logoObjectUrl: boolean;
  name: string | null;
};

type CachedCompanyBrand = {
  sessionKey: string;
  promise: Promise<CompanyBrand>;
};

type PreparedLogo = {
  usable: boolean;
  displayUrl: string;
};

let cachedCompanyBrand: CachedCompanyBrand | null = null;

async function resolveCompanyLogo(rawLogo: string | null | undefined): Promise<{ url: string | null; objectUrl: boolean }> {
  const logo = rawLogo?.trim();
  if (!logo) return { url: null, objectUrl: false };

  // Data/blob/public URLs can be rendered directly. Relative API media paths need
  // the authenticated media helper, exactly like product images.
  if (/^(?:data:|blob:|https?:\/\/)/i.test(logo)) {
    return { url: logo, objectUrl: false };
  }

  const url = await fetchImageUrl(logo).catch(() => null);
  return { url, objectUrl: Boolean(url) };
}

/**
 * يتحقق من الشعار ويُنشئ نسخة عرض مقصوصة من الهوامش البيضاء/الشفافة فقط.
 * النسخة الناتجة مؤقتة في جلسة POS ولا تعدل الشعار المخزن أو بيانات المنشأة.
 */
async function prepareCompanyLogo(url: string): Promise<PreparedLogo> {
  return new Promise((resolve) => {
    const image = new Image();

    image.onload = () => {
      if (image.naturalWidth < 2 || image.naturalHeight < 2) {
        resolve({ usable: false, displayUrl: url });
        return;
      }

      const analysisCanvas = document.createElement('canvas');
      const maxAnalysisSize = 256;
      const analysisScale = Math.min(1, maxAnalysisSize / Math.max(image.naturalWidth, image.naturalHeight));
      analysisCanvas.width = Math.max(2, Math.round(image.naturalWidth * analysisScale));
      analysisCanvas.height = Math.max(2, Math.round(image.naturalHeight * analysisScale));

      const context = analysisCanvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        resolve({ usable: true, displayUrl: url });
        return;
      }

      try {
        context.clearRect(0, 0, analysisCanvas.width, analysisCanvas.height);
        context.drawImage(image, 0, 0, analysisCanvas.width, analysisCanvas.height);
        const imageData = context.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
        if (!hasMeaningfulLogoPixels(imageData.data)) {
          resolve({ usable: false, displayUrl: url });
          return;
        }

        const bounds = findLogoContentBounds(imageData.data, analysisCanvas.width, analysisCanvas.height);
        if (!bounds) {
          resolve({ usable: true, displayUrl: url });
          return;
        }

        const sourceX = Math.max(0, Math.floor(bounds.x / analysisScale));
        const sourceY = Math.max(0, Math.floor(bounds.y / analysisScale));
        const sourceWidth = Math.min(
          image.naturalWidth - sourceX,
          Math.max(1, Math.ceil(bounds.width / analysisScale)),
        );
        const sourceHeight = Math.min(
          image.naturalHeight - sourceY,
          Math.max(1, Math.ceil(bounds.height / analysisScale)),
        );

        // لا نعيد ترميز الصورة إن كانت الهوامش أصلاً صغيرة؛ نتجنب عملاً بلا فائدة.
        const retainedAreaRatio = (sourceWidth * sourceHeight) / (image.naturalWidth * image.naturalHeight);
        if (retainedAreaRatio >= 0.82) {
          resolve({ usable: true, displayUrl: url });
          return;
        }

        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = sourceWidth;
        outputCanvas.height = sourceHeight;
        const outputContext = outputCanvas.getContext('2d');
        if (!outputContext) {
          resolve({ usable: true, displayUrl: url });
          return;
        }

        outputContext.drawImage(
          image,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          0,
          0,
          sourceWidth,
          sourceHeight,
        );

        resolve({ usable: true, displayUrl: outputCanvas.toDataURL('image/png') });
      } catch {
        // شعارات خارجية قد تمنع قراءة Canvas عبر CORS. في هذه الحالة نحافظ على
        // الشعار الأصلي ويظل onError حارس التحميل بدلاً من إسقاط شعار صالح.
        resolve({ usable: true, displayUrl: url });
      }
    };

    image.onerror = () => resolve({ usable: false, displayUrl: url });
    image.src = url;
  });
}

function getCompanyBrand(): Promise<CompanyBrand> {
  // Cache per authenticated session so a POS grid does not call /me once per card.
  // A tenant/session switch changes the token and invalidates the cached brand.
  const sessionKey = getToken() ?? 'anonymous';
  if (cachedCompanyBrand?.sessionKey === sessionKey) return cachedCompanyBrand.promise;

  const previous = cachedCompanyBrand;
  if (previous) {
    void previous.promise.then((value) => {
      if (value.logoObjectUrl && value.logoUrl) URL.revokeObjectURL(value.logoUrl);
    }).catch(() => {});
  }

  const promise = api<{ company?: { logo?: string | null; name?: string | null } }>('/me')
    .then(async (response) => {
      const resolved = await resolveCompanyLogo(response.company?.logo);
      const prepared = resolved.url
        ? await prepareCompanyLogo(resolved.url)
        : { usable: false, displayUrl: '' };

      if (!prepared.usable && resolved.objectUrl && resolved.url) {
        URL.revokeObjectURL(resolved.url);
      }

      return {
        logoUrl: prepared.usable ? prepared.displayUrl : null,
        // النسخة المقصوصة Data URL لا تحتاج revoke. نحتفظ بالعلم فقط عندما
        // نعرض Object URL الأصلي بلا إعادة معالجة.
        logoObjectUrl: prepared.usable && prepared.displayUrl === resolved.url ? resolved.objectUrl : false,
        name: response.company?.name?.trim() || null,
      };
    })
    .catch(() => ({ logoUrl: null, logoObjectUrl: false, name: null }));

  cachedCompanyBrand = { sessionKey, promise };
  return promise;
}

/**
 * صورة منتج POS مع تسلسل احتياطي موحّد:
 * صورة المنتج → شعار منشأة صالح ومهيأ للعرض → Package + اسم المنشأة.
 * الشعار للعرض فقط ولا يُنسخ إلى سجل المنتج أو التخزين.
 */
export function PosProductImage({ path, alt }: { path: string | null | undefined; alt: string }) {
  const [productUrl, setProductUrl] = useState<string | null>(null);
  const [productFailed, setProductFailed] = useState(false);
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [companyLogoFailed, setCompanyLogoFailed] = useState(false);

  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    setProductFailed(false);

    if (!path) {
      setProductUrl(null);
      return undefined;
    }

    void fetchImageUrl(path)
      .then((value) => {
        if (!live) {
          if (value) URL.revokeObjectURL(value);
          return;
        }
        objectUrl = value;
        setProductUrl(value);
      })
      .catch(() => {
        if (live) setProductUrl(null);
      });

    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  useEffect(() => {
    let live = true;
    setCompanyLogoFailed(false);

    void getCompanyBrand().then((value) => {
      if (!live) return;
      setCompanyLogoUrl(value.logoUrl);
      setCompanyName(value.name);
    });

    return () => {
      live = false;
    };
  }, []);

  if (productUrl && !productFailed) {
    return (
      <img
        src={productUrl}
        alt={alt}
        loading="lazy"
        className="h-full w-full object-cover"
        onError={() => setProductFailed(true)}
      />
    );
  }

  if (companyLogoUrl && !companyLogoFailed) {
    return (
      <span className="flex h-full w-full items-center justify-center overflow-hidden bg-surface px-4 py-3" aria-hidden>
        <img
          src={companyLogoUrl}
          alt=""
          loading="lazy"
          className="max-h-[78%] max-w-[78%] object-contain"
          onError={() => setCompanyLogoFailed(true)}
        />
      </span>
    );
  }

  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-surface text-muted" aria-hidden>
      <Package className="h-5 w-5" strokeWidth={1.5} />
      {companyName ? (
        <span className="max-w-[80%] truncate text-[10px] font-medium" dir="auto">
          {companyName}
        </span>
      ) : null}
    </span>
  );
}

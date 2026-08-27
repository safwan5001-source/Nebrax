'use client';

import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { api, fetchImageUrl, getToken } from '@/lib/api';
import { hasMeaningfulLogoPixels } from './company-logo-quality';

type CompanyBrand = {
  logoUrl: string | null;
  logoObjectUrl: boolean;
  name: string | null;
};

type CachedCompanyBrand = {
  sessionKey: string;
  promise: Promise<CompanyBrand>;
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
 * بعض الشعارات القديمة مخزنة كـPNG صالح تقنياً لكنه أبيض/فارغ بصرياً؛ لذلك
 * onError لا يكتشفها. نفحص عينة صغيرة مرة واحدة لكل جلسة قبل اعتماد الشعار.
 */
async function isVisuallyUsableLogo(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();

    image.onload = () => {
      if (image.naturalWidth < 2 || image.naturalHeight < 2) {
        resolve(false);
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        resolve(true);
        return;
      }

      try {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        resolve(hasMeaningfulLogoPixels(pixels));
      } catch {
        // قد تمنع CORS قراءة بكسلات شعار خارجي. في هذه الحالة لا نحجب شعاراً
        // صالحاً لمجرد أن Canvas لا يستطيع فحصه؛ يبقى onError حارس التحميل.
        resolve(true);
      }
    };

    image.onerror = () => resolve(false);
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
      const usable = resolved.url ? await isVisuallyUsableLogo(resolved.url) : false;

      if (!usable && resolved.objectUrl && resolved.url) {
        URL.revokeObjectURL(resolved.url);
      }

      return {
        logoUrl: usable ? resolved.url : null,
        logoObjectUrl: usable ? resolved.objectUrl : false,
        name: response.company?.name?.trim() || null,
      };
    })
    .catch(() => ({ logoUrl: null, logoObjectUrl: false, name: null }));

  cachedCompanyBrand = { sessionKey, promise };
  return promise;
}

/**
 * صورة منتج POS مع تسلسل احتياطي موحّد:
 * صورة المنتج → شعار منشأة صالح بصرياً → Package + اسم المنشأة.
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
      <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 overflow-hidden bg-surface px-3 py-2" aria-hidden>
        <img
          src={companyLogoUrl}
          alt=""
          loading="lazy"
          className="max-h-[68%] max-w-[72%] object-contain"
          onError={() => setCompanyLogoFailed(true)}
        />
        {companyName ? (
          <span className="max-w-full truncate text-[10px] font-medium text-muted" dir="auto">
            {companyName}
          </span>
        ) : null}
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

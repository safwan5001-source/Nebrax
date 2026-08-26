'use client';

import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { api, fetchImageUrl, getToken } from '@/lib/api';

type CachedCompanyLogo = {
  sessionKey: string;
  promise: Promise<{ url: string | null; objectUrl: boolean }>;
};

let cachedCompanyLogo: CachedCompanyLogo | null = null;

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

function getCompanyLogo(): Promise<{ url: string | null; objectUrl: boolean }> {
  // Cache per authenticated session so a POS grid does not call /me once per card.
  // A tenant/session switch changes the token and invalidates the cached brand.
  const sessionKey = getToken() ?? 'anonymous';
  if (cachedCompanyLogo?.sessionKey === sessionKey) return cachedCompanyLogo.promise;

  const previous = cachedCompanyLogo;
  if (previous) {
    void previous.promise.then((value) => {
      if (value.objectUrl && value.url) URL.revokeObjectURL(value.url);
    }).catch(() => {});
  }

  const promise = api<{ company?: { logo?: string | null } }>('/me')
    .then((response) => resolveCompanyLogo(response.company?.logo))
    .catch(() => ({ url: null, objectUrl: false }));

  cachedCompanyLogo = { sessionKey, promise };
  return promise;
}

/**
 * صورة منتج POS مع تسلسل احتياطي موحّد:
 * صورة المنتج → شعار المنشأة الحالية → Package محايد.
 * الشعار للعرض فقط ولا يُنسخ إلى سجل المنتج أو التخزين.
 */
export function PosProductImage({ path, alt }: { path: string | null | undefined; alt: string }) {
  const [productUrl, setProductUrl] = useState<string | null>(null);
  const [productFailed, setProductFailed] = useState(false);
  const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
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

    void getCompanyLogo().then((value) => {
      if (live) setCompanyLogoUrl(value.url);
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
      <span className="grid h-full w-full place-items-center bg-background" aria-hidden>
        <img
          src={companyLogoUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-contain p-2"
          onError={() => setCompanyLogoFailed(true)}
        />
      </span>
    );
  }

  return (
    <span className="grid h-full w-full place-items-center bg-background text-muted" aria-hidden>
      <Package className="h-5 w-5" strokeWidth={1.5} />
    </span>
  );
}

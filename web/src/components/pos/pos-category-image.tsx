'use client';

import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { fetchImageUrl } from '@/lib/api';

/** صورة تصنيف POS محمية؛ fallback موحّد يحافظ على مساحة العنصر عند غياب الصورة. */
export function PosCategoryImage({ path, alt }: { path: string | null | undefined; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let objectUrl: string | null = null;
    if (!path) {
      setUrl(null);
      return undefined;
    }

    void fetchImageUrl(path)
      .then((value) => {
        if (!live) {
          if (value) URL.revokeObjectURL(value);
          return;
        }
        objectUrl = value;
        setUrl(value);
      })
      .catch(() => {
        if (live) setUrl(null);
      });

    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  if (!url) {
    return (
      <span className="grid h-full w-full place-items-center bg-primary-soft text-primary" aria-hidden>
        <Package className="h-5 w-5" strokeWidth={1.6} />
      </span>
    );
  }

  return <img src={url} alt={alt} loading="lazy" className="h-full w-full object-cover" />;
}

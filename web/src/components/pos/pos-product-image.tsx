'use client';

import { useEffect, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import { fetchImageUrl } from '@/lib/api';

/** يحمل رابط blob مصادقاً عليه؛ لا يستطيع عنصر img إرسال bearer token بمفرده. */
export function PosProductImage({ path, alt }: { path: string | null | undefined; alt: string }) {
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
      <span className="grid h-full w-full place-items-center bg-background text-muted" aria-hidden>
        <ImageIcon className="h-5 w-5" strokeWidth={1.5} />
      </span>
    );
  }

  return <img src={url} alt={alt} loading="lazy" className="h-full w-full object-cover" />;
}

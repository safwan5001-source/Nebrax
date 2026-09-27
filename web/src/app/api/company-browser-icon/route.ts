import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

const FALLBACK_ICON = '/icon.ico';
const SAFE_COMPANY_LOGO = /^(https:\/\/[^\s]+|data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/]+=*)$/i;
const DATA_IMAGE = /^data:image\/(png|jpeg|jpg|webp);base64,([a-z0-9+/]+=*)$/i;

function fallback(request: Request): NextResponse {
  return NextResponse.redirect(new URL(FALLBACK_ICON, request.url), 307);
}

function dataImageResponse(value: string): Response | null {
  const match = DATA_IMAGE.exec(value);
  if (!match) return null;
  try {
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length === 0) return null;
    const subtype = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase();
    return new Response(bytes, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': `image/${subtype}`,
      },
    });
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  const requestHeaders = await headers();
  const host = requestHeaders.get('host');
  const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, '');
  if (!host || !apiBase) return fallback(request);

  const protocol = requestHeaders.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  try {
    const response = await fetch(`${apiBase}/company-browser-identity`, {
      headers: {
        Accept: 'application/json',
        Origin: `${protocol}://${host}`,
      },
      cache: 'no-store',
    });
    if (!response.ok) return fallback(request);

    const body = (await response.json()) as { logo?: unknown };
    const logo = typeof body.logo === 'string' ? body.logo.trim() : '';
    if (!SAFE_COMPANY_LOGO.test(logo)) return fallback(request);

    const dataResponse = dataImageResponse(logo);
    return dataResponse ?? NextResponse.redirect(logo, 307);
  } catch {
    return fallback(request);
  }
}

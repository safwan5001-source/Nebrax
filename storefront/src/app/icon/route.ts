import { NextResponse } from "next/server";
import { fetchPublishedPresentation } from "@/lib/commerce/storefront";
import { publishedFaviconUrl } from "@/lib/presentation/public";

const FALLBACK_ICON = "/favicon.ico";
const DATA_IMAGE = /^data:image\/(png|jpeg|jpg|webp);base64,([a-z0-9+/]+=*)$/i;

function fallback(request: Request): NextResponse {
  return NextResponse.redirect(new URL(FALLBACK_ICON, request.url), 307);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const presentation = await fetchPublishedPresentation();
    const favicon = publishedFaviconUrl(presentation);
    if (!favicon) return fallback(request);

    const match = DATA_IMAGE.exec(favicon);
    if (match) {
      const bytes = Buffer.from(match[2], "base64");
      if (bytes.length === 0) return fallback(request);
      const subtype =
        match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
      return new Response(bytes, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": `image/${subtype}`,
        },
      });
    }

    return NextResponse.redirect(favicon, 307);
  } catch {
    return fallback(request);
  }
}

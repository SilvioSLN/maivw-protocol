import { NextRequest, NextResponse } from "next/server";

// 1x1 GIF transparente para fallback silencioso
const TRANSPARENT_1PX_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

/**
 * Validação de segurança anti-SSRF para o proxy de imagens
 */
function isAllowedUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    // Bloqueia tentativas de acesso a rede local ou metadados de nuvem
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname === "169.254.169.254" || // AWS metadata
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * GET /api/proxy/image?url=https://...
 * 
 * Proxy de imagens seguro para o WebMaivw (estilo Gmail Image Proxy):
 * 1. Bypassa restrições de Cross-Origin-Resource-Policy: same-origin de servidores remotos
 * 2. Protege a privacidade do usuário contra vazamento de IP / User-Agent para terceiros
 * 3. Habilita cache de longo prazo no navegador do usuário
 */
export async function GET(request: NextRequest) {
  const urlParam = request.nextUrl.searchParams.get("url");

  if (!urlParam || !isAllowedUrl(urlParam)) {
    return new NextResponse(TRANSPARENT_1PX_GIF, {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  try {
    const upstream = await fetch(urlParam, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(6000),
      redirect: "follow",
    });

    if (!upstream.ok) {
      return new NextResponse(TRANSPARENT_1PX_GIF, {
        status: 200,
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    const contentType = upstream.headers.get("content-type") || "image/png";
    const imageBuffer = await upstream.arrayBuffer();

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  } catch {
    return new NextResponse(TRANSPARENT_1PX_GIF, {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "public, max-age=1800",
      },
    });
  }
}

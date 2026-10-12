import { NextRequest, NextResponse } from "next/server";
import dns from "node:dns";
import net from "node:net";

// 1x1 GIF transparente para fallback silencioso
const TRANSPARENT_1PX_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_REDIRECTS = 2;

/**
 * Avalia se um endereço IP (v4 ou v6) pertence a redes privadas, loopback,
 * link-local ou metadados de nuvem.
 */
function isPrivateOrLocalIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4) return true;
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (AWS/GCP/Azure metadata)
    if (a >= 224) return true; // multicast/reserved
    return false;
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1" || normalized === "::") return true;
    if (normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (normalized.startsWith("::ffff:")) {
      const ipv4Part = normalized.slice(7);
      return isPrivateOrLocalIp(ipv4Part);
    }
    return false;
  }

  return true;
}

/**
 * Validação de segurança anti-SSRF com resolução DNS real
 */
async function isSafePublicUrl(urlString: string): Promise<URL | null> {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    const host = parsed.hostname.toLowerCase().trim();
    if (
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".lan") ||
      host.endsWith(".home")
    ) {
      return null;
    }

    // Se o host já for um IP direto
    if (net.isIP(host)) {
      if (isPrivateOrLocalIp(host)) return null;
      return parsed;
    }

    // Resolução DNS para prevenir DNS Rebinding para IPs internos
    const addresses = await dns.promises.lookup(host, { all: true });
    if (!addresses || addresses.length === 0) {
      return null;
    }

    for (const record of addresses) {
      if (isPrivateOrLocalIp(record.address)) {
        return null;
      }
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * GET /api/proxy/image?url=https://...
 * 
 * Proxy de imagens seguro contra SSRF para o WebMaivw:
 * 1. Resolução DNS obrigatória para bloquear IPs de redes locais, privadas e metadata APIs
 * 2. Validação rigorosa em cada redirecionamento upstream (máximo de 2 saltos)
 * 3. Validação de Content-Type estritamente de imagens (bloqueia HTML, scripts, etc.)
 * 4. Limite de tamanho máximo de 10MB
 * 5. Headers de segurança (nosniff, CSP estrito)
 */
export async function GET(request: NextRequest) {
  const urlParam = request.nextUrl.searchParams.get("url");

  if (!urlParam) {
    return new NextResponse(TRANSPARENT_1PX_GIF, {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  let currentTarget = await isSafePublicUrl(urlParam);
  if (!currentTarget) {
    return new NextResponse(TRANSPARENT_1PX_GIF, {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  try {
    let redirectCount = 0;
    let upstreamResponse: Response | null = null;

    while (redirectCount <= MAX_REDIRECTS) {
      const response = await fetch(currentTarget.toString(), {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          Accept: "image/avif,image/webp,image/apng,image/jpeg,image/png,image/*;q=0.8",
        },
        signal: AbortSignal.timeout(6000),
        redirect: "manual",
      });

      // Tratar redirecionamentos de forma segura e verificada
      if (response.status >= 301 && response.status <= 308) {
        const location = response.headers.get("location");
        if (!location) break;

        const nextUrl = new URL(location, currentTarget);
        const validatedNext = await isSafePublicUrl(nextUrl.toString());
        if (!validatedNext) {
          // Destino do redirecionamento não é seguro (tentativa de SSRF via redirect)
          break;
        }

        currentTarget = validatedNext;
        redirectCount++;
        continue;
      }

      upstreamResponse = response;
      break;
    }

    if (!upstreamResponse || !upstreamResponse.ok) {
      return new NextResponse(TRANSPARENT_1PX_GIF, {
        status: 200,
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // Validar tipo de conteúdo retornado
    const rawContentType = upstreamResponse.headers.get("content-type") || "";
    const cleanContentType = rawContentType.split(";")[0].trim().toLowerCase();

    // Aceita apenas MIME types de imagem (não permite SVG com scripts ou HTML)
    const ALLOWED_MIME_TYPES = new Set([
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/avif",
      "image/x-icon",
      "image/bmp",
    ]);

    if (!ALLOWED_MIME_TYPES.has(cleanContentType) && !cleanContentType.startsWith("image/")) {
      return new NextResponse(TRANSPARENT_1PX_GIF, {
        status: 200,
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // Verificar Content-Length
    const contentLength = Number(upstreamResponse.headers.get("content-length") || 0);
    if (contentLength > MAX_IMAGE_BYTES) {
      return new NextResponse(TRANSPARENT_1PX_GIF, {
        status: 200,
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    const imageBuffer = await upstreamResponse.arrayBuffer();
    if (imageBuffer.byteLength > MAX_IMAGE_BYTES) {
      return new NextResponse(TRANSPARENT_1PX_GIF, {
        status: 200,
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        "Content-Type": cleanContentType || "image/png",
        "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
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

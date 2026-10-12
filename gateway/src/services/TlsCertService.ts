import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import type { Hex } from "viem";

const DEFAULT_CERTS_DIR = path.resolve(process.cwd(), "data/certs");

export interface TlsNodeCredentials {
  certPem: string;
  keyPem: string;
  fingerprintSha256: Hex;
}

/**
 * TlsCertService — Gerenciamento e Validação de Certificados TLS / DANE On-Chain (S08)
 * 
 * Computa fingerprints SHA-256 do certificado DER completo conforme a especificação DANE (RFC 6698).
 * Suporta certificados auto-assinados locais com ancoragem on-chain no contrato MAIVWRegistry.
 */
export class TlsCertService {
  /**
   * Normaliza um fingerprint hex para o formato canônico bytes32 ("0x" + 64 caracteres hex em minúsculo)
   */
  static normalizeFingerprint(raw: string): Hex {
    const cleaned = raw.replace(/[:\s-]/g, "").toLowerCase().replace(/^0x/, "");
    if (cleaned.length !== 64) {
      throw new Error(`Fingerprint inválido: esperado 32 bytes (64 hex chars), recebido ${cleaned.length}`);
    }
    return `0x${cleaned}` as Hex;
  }

  /**
   * Calcula o fingerprint SHA-256 a partir de um certificado X.509 em formato PEM ou DER (Buffer)
   */
  static computeCertFingerprint(certInput: string | Buffer): Hex {
    try {
      const x509 = new crypto.X509Certificate(certInput);
      const hash = crypto.createHash("sha256").update(x509.raw).digest("hex");
      return `0x${hash.toLowerCase()}` as Hex;
    } catch (err: any) {
      // Se já for um buffer binário DER
      if (Buffer.isBuffer(certInput)) {
        const hash = crypto.createHash("sha256").update(certInput).digest("hex");
        return `0x${hash.toLowerCase()}` as Hex;
      }
      throw new Error(`Falha ao calcular fingerprint de certificado X.509: ${err.message}`);
    }
  }

  /**
   * Compara se o fingerprint real observado confere com o fingerprint esperado ancorado on-chain
   */
  static matchesFingerprint(actualFingerprint: string, expectedFingerprint: string): boolean {
    try {
      const a = TlsCertService.normalizeFingerprint(actualFingerprint);
      const e = TlsCertService.normalizeFingerprint(expectedFingerprint);
      return a.toLowerCase() === e.toLowerCase();
    } catch {
      return false;
    }
  }

  /**
   * Carrega credenciais TLS configuradas ou gera par auto-assinado em data/certs se inexistente
   */
  static getOrProvisionNodeCredentials(options?: {
    certPath?: string;
    keyPath?: string;
    domain?: string;
    certsDir?: string;
  }): TlsNodeCredentials {
    const certsDir = options?.certsDir || DEFAULT_CERTS_DIR;
    const certPath = options?.certPath || path.join(certsDir, "node.crt");
    const keyPath = options?.keyPath || path.join(certsDir, "node.key");
    const domain = options?.domain || "localhost";

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      const certPem = fs.readFileSync(certPath, "utf-8");
      const keyPem = fs.readFileSync(keyPath, "utf-8");
      const fingerprintSha256 = TlsCertService.computeCertFingerprint(certPem);
      return { certPem, keyPem, fingerprintSha256 };
    }

    if (!fs.existsSync(certsDir)) {
      fs.mkdirSync(certsDir, { recursive: true });
    }

    // Auto-geração de certificado auto-assinado usando openssl ou fallback
    try {
      execSync(
        `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 ` +
        `-keyout "${keyPath}" -out "${certPath}" -days 3650 -nodes ` +
        `-subj "/CN=${domain}/O=MAIVW P2P Node" 2>/dev/null`
      );
    } catch (execErr: any) {
      // Fallback para RSA se curvas elípticas falharem
      execSync(
        `openssl req -x509 -newkey rsa:2048 ` +
        `-keyout "${keyPath}" -out "${certPath}" -days 3650 -nodes ` +
        `-subj "/CN=${domain}/O=MAIVW P2P Node"`
      );
    }

    const certPem = fs.readFileSync(certPath, "utf-8");
    const keyPem = fs.readFileSync(keyPath, "utf-8");
    const fingerprintSha256 = TlsCertService.computeCertFingerprint(certPem);

    return { certPem, keyPem, fingerprintSha256 };
  }

  /**
   * Despacha uma requisição P2P com suporte a mTLS e validação de ancoragem on-chain (DANE)
   */
  static async dispatchP2PRequest(
    targetUrl: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      recipientFingerprint?: Hex | string | null;
      nodeCredentials?: TlsNodeCredentials | null;
      timeoutMs?: number;
    } = {}
  ): Promise<{
    status: number;
    ok: boolean;
    headers: Record<string, string | string[] | undefined>;
    json: () => Promise<any>;
    text: () => Promise<string>;
  }> {
    const {
      method = "POST",
      headers = {},
      body = "",
      recipientFingerprint,
      nodeCredentials,
      timeoutMs = 6000,
    } = options;

    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === "https:";

    // Se o domínio destinatário tem ancoragem on-chain (DANE), rejeita HTTP inseguro (Fail-Closed)
    if (!isHttps && recipientFingerprint) {
      throw new Error(
        `[DANE] InsecureTransportError: O domínio destinatário possui ancoragem TLS on-chain (${recipientFingerprint}), mas a URL alvo (${targetUrl}) utiliza protocolo HTTP inseguro.`
      );
    }

    // Se for HTTP sem ancoragem, usa fetch padrão
    if (!isHttps) {
      const res = await fetch(targetUrl, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      return {
        status: res.status,
        ok: res.ok,
        headers: Object.fromEntries(res.headers.entries()),
        json: () => res.json(),
        text: () => res.text(),
      };
    }

    // HTTPS com suporte a mTLS e verificação DANE on-chain
    const https = await import("node:https");

    return new Promise((resolve, reject) => {
      let isSettled = false;

      const reqHeaders = { ...headers };
      if (nodeCredentials?.fingerprintSha256 && !reqHeaders["x-client-cert-fingerprint-sha256"]) {
        reqHeaders["x-client-cert-fingerprint-sha256"] = nodeCredentials.fingerprintSha256;
      }

      const req = https.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: `${parsed.pathname}${parsed.search}`,
          method,
          headers: reqHeaders,
          cert: nodeCredentials?.certPem,
          key: nodeCredentials?.keyPem,
          rejectUnauthorized: false, // DANE valida a identidade criptográfica pelo fingerprint on-chain
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(Buffer.from(c)));
          res.on("end", () => {
            if (isSettled) return;
            isSettled = true;
            const fullBuf = Buffer.concat(chunks);
            const textContent = fullBuf.toString("utf-8");
            resolve({
              status: res.statusCode || 500,
              ok: (res.statusCode || 500) >= 200 && (res.statusCode || 500) < 300,
              headers: res.headers,
              json: async () => JSON.parse(textContent),
              text: async () => textContent,
            });
          });
        }
      );

      // Verificação DANE na conexão segura antes do envio de payloads
      req.on("socket", (socket: any) => {
        socket.once("secureConnect", () => {
          if (recipientFingerprint) {
            const peerCert = socket.getPeerCertificate(true);
            if (!peerCert || !peerCert.raw) {
              const err = new Error(
                `[DANE] Falha de validação TLS: Destinatário não apresentou certificado X.509 para conferência on-chain.`
              );
              req.destroy(err);
              return;
            }
            const actualFingerprint = TlsCertService.computeCertFingerprint(peerCert.raw);
            if (!TlsCertService.matchesFingerprint(actualFingerprint, recipientFingerprint)) {
              const err = new Error(
                `[DANE] TLS Fingerprint Mismatch: Esperado on-chain ${recipientFingerprint}, recebido ${actualFingerprint}`
              );
              req.destroy(err);
              return;
            }
          }
        });
      });

      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          req.destroy(new Error(`[DANE] Timeout na requisição TLS após ${timeoutMs}ms`));
        }
      }, timeoutMs);

      req.on("error", (err) => {
        clearTimeout(timer);
        if (!isSettled) {
          isSettled = true;
          reject(err);
        }
      });

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }
}


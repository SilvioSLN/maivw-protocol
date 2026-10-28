import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { X509Certificate, createHash } from 'node:crypto';

export function inspectCertificate(certPath, thresholdDays = 14) {
  const resolved = resolve(process.cwd(), certPath);
  if (!existsSync(resolved)) {
    return {
      status: 'MISSING',
      certPath: resolved,
      exists: false,
      thresholdDays,
      warning: true,
      critical: true,
      message: `Certificado não encontrado no caminho: ${resolved}`,
    };
  }

  try {
    const rawPem = readFileSync(resolved, 'utf8');
    const x509 = new X509Certificate(rawPem);
    const now = Date.now();
    const validToDate = new Date(x509.validTo);
    const validFromDate = new Date(x509.validFrom);
    const msRemaining = validToDate.getTime() - now;
    const hoursRemaining = Math.floor(msRemaining / (1000 * 60 * 60));
    const daysRemaining = Math.floor(msRemaining / (1000 * 60 * 60 * 24));

    const derHash = createHash('sha256').update(x509.raw).digest('hex');
    const fingerprintSha256 = `0x${derHash.toLowerCase()}`;

    if (daysRemaining <= 0) {
      return {
        status: 'EXPIRED',
        certPath: resolved,
        exists: true,
        subject: x509.subject,
        issuer: x509.issuer,
        validFrom: validFromDate.toISOString(),
        validTo: validToDate.toISOString(),
        daysRemaining,
        hoursRemaining,
        fingerprintSha256,
        thresholdDays,
        warning: true,
        critical: true,
        message: `CRÍTICO: Certificado expirou há ${Math.abs(daysRemaining)} dias em ${validToDate.toISOString()}`,
      };
    }

    if (daysRemaining <= thresholdDays) {
      return {
        status: 'EXPIRING_SOON',
        certPath: resolved,
        exists: true,
        subject: x509.subject,
        issuer: x509.issuer,
        validFrom: validFromDate.toISOString(),
        validTo: validToDate.toISOString(),
        daysRemaining,
        hoursRemaining,
        fingerprintSha256,
        thresholdDays,
        warning: true,
        critical: false,
        message: `ALERTA: Certificado expira em ${daysRemaining} dias (${hoursRemaining} horas) em ${validToDate.toISOString()}`,
      };
    }

    return {
      status: 'HEALTHY',
      certPath: resolved,
      exists: true,
      subject: x509.subject,
      issuer: x509.issuer,
      validFrom: validFromDate.toISOString(),
      validTo: validToDate.toISOString(),
      daysRemaining,
      hoursRemaining,
      fingerprintSha256,
      thresholdDays,
      warning: false,
      critical: false,
      message: `Saudável: Certificado válido por mais ${daysRemaining} dias (até ${validToDate.toISOString()})`,
    };
  } catch (err) {
    return {
      status: 'MISSING',
      certPath: resolved,
      exists: true,
      thresholdDays,
      warning: true,
      critical: true,
      message: `Erro ao analisar certificado X.509: ${err.message}`,
    };
  }
}

export interface EmailProviderPreset {
  id: string;
  name: string;
  category: "api" | "smtp";
  badge?: string;
  description: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  helpTip: string;
  authType: "apiKey" | "credentials";
}

export const EMAIL_PROVIDER_PRESETS: Record<string, EmailProviderPreset> = {
  resend: {
    id: "resend",
    name: "Resend",
    category: "api",
    badge: "Cloud API",
    description: "API moderna de envio em nuvem com alta entregabilidade.",
    authType: "apiKey",
    helpTip: "Utilize uma API Key iniciada com 're_' gerada no dashboard da Resend.",
  },
  gmail: {
    id: "gmail",
    name: "Google Workspace / Gmail",
    category: "smtp",
    badge: "Mais Popular",
    description: "Servidores seguros do Google Workspace com SSL/TLS.",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
    authType: "credentials",
    helpTip: "Requer Senha de App: acesse Conta Google > Segurança > Verificação em duas etapas > Senhas de app e gere uma senha de 16 letras para o MAIVW.",
  },
  outlook: {
    id: "outlook",
    name: "Microsoft 365 / Outlook",
    category: "smtp",
    badge: "Corporativo",
    description: "Servidores oficiais do Microsoft 365 e Exchange Online.",
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false, // STARTTLS
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSecure: true,
    authType: "credentials",
    helpTip: "Certifique-se de que a opção 'SMTP Autenticado' está habilitada no painel de administração do Microsoft 365 para esta conta de e-mail.",
  },
  zoho: {
    id: "zoho",
    name: "Zoho Mail",
    category: "smtp",
    badge: "Business",
    description: "E-mail corporativo Zoho com criptografia SSL nativa.",
    smtpHost: "smtppro.zoho.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imappro.zoho.com",
    imapPort: 993,
    imapSecure: true,
    authType: "credentials",
    helpTip: "Se sua conta possuir autenticação em dois fatores (2FA), gere uma Senha de Aplicativo em Zoho Accounts > Segurança.",
  },
  hostinger: {
    id: "hostinger",
    name: "Hostinger",
    category: "smtp",
    badge: "Hospedagem",
    description: "Servidor seguro SSL 465 da Hostinger / Titan Mail.",
    smtpHost: "smtp.hostinger.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imap.hostinger.com",
    imapPort: 993,
    imapSecure: true,
    authType: "credentials",
    helpTip: "Utilize o endereço de e-mail completo e a senha criada no painel de e-mails da Hostinger.",
  },
  locaweb: {
    id: "locaweb",
    name: "Locaweb",
    category: "smtp",
    badge: "Brasil",
    description: "Servidor oficial com certificado SSL da Locaweb.",
    smtpHost: "email-ssl.com.br",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "email-ssl.com.br",
    imapPort: 993,
    imapSecure: true,
    authType: "credentials",
    helpTip: "Utilize o e-mail completo e a senha cadastrada no painel de e-mail corporativo da Locaweb.",
  },
  umbler: {
    id: "umbler",
    name: "Umbler",
    category: "smtp",
    badge: "Cloud",
    description: "Servidor de envio SMTP otimizado da Umbler.",
    smtpHost: "smtp.umbler.com",
    smtpPort: 587,
    smtpSecure: false, // STARTTLS
    imapHost: "imap.umbler.com",
    imapPort: 993,
    imapSecure: true,
    authType: "credentials",
    helpTip: "Utilize as credenciais da caixa postal criada no painel da Umbler.",
  },
  cpanel: {
    id: "cpanel",
    name: "cPanel / Servidor Próprio",
    category: "smtp",
    badge: "Soberania",
    description: "Conexão direta com seu servidor VPS/Dedicado ou cPanel com SSL.",
    smtpHost: "mail.{domain}",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "mail.{domain}",
    imapPort: 993,
    imapSecure: true,
    authType: "credentials",
    helpTip: "O host é preenchido automaticamente com seu domínio. Utiliza porta SSL 465 com o usuário e senha da conta de e-mail do cPanel.",
  },
  custom_smtp: {
    id: "custom_smtp",
    name: "Servidor SMTP Customizado",
    category: "smtp",
    badge: "Avançado",
    description: "Configure qualquer servidor SMTP/IMAP com portas e protocolos personalizados.",
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    authType: "credentials",
    helpTip: "Insira manualmente o host, porta e selecione se a conexão exige SSL direto (465) ou STARTTLS (587).",
  },
};

export function getPresetForProvider(providerId: string, domainName?: string): EmailProviderPreset | null {
  const preset = EMAIL_PROVIDER_PRESETS[providerId];
  if (!preset) return null;

  if (domainName && preset.id === "cpanel") {
    return {
      ...preset,
      smtpHost: `mail.${domainName}`,
      imapHost: `mail.${domainName}`,
    };
  }

  return preset;
}

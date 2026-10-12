export interface EmailProviderPreset {
  id: string;
  name: string;
  badge: string;
  description: string;
  category: "api" | "smtp";
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  authType: "apiKey" | "credentials";
  helpTip: string;
  stepByStep: string[];
  recommended?: boolean;
}

export const EMAIL_PRESETS: EmailProviderPreset[] = [
  {
    id: "resend",
    name: "Resend",
    badge: "Cloud API",
    description: "API moderna em nuvem com alta entregabilidade.",
    category: "api",
    authType: "apiKey",
    helpTip: "API moderna recomendada para entrega ultrarrápida e alta reputação.",
    stepByStep: [
      "Acesse seu painel em resend.com/api-keys",
      "Clique em 'Create API Key'",
      "Cole a chave (iniciada em 're_') no campo abaixo",
    ],
    recommended: true,
  },
  {
    id: "gmail",
    name: "Google Workspace / Gmail",
    badge: "Mais Popular",
    description: "Servidores seguros do Google Workspace com SSL/TLS.",
    category: "smtp",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
    authType: "credentials",
    helpTip: "Requer Senha de App de 16 letras gerada na sua Conta Google.",
    stepByStep: [
      "Acesse sua Conta Google > Segurança > Verificação em duas etapas",
      "No final da página, clique em 'Senhas de app'",
      "Crie um nome (ex: MAIVW) e copie a senha de 16 caracteres gerada",
      "Cole a senha de 16 letras no campo de Senha abaixo",
    ],
  },
  {
    id: "outlook",
    name: "Microsoft 365 / Outlook",
    badge: "Corporativo",
    description: "Servidores oficiais do Microsoft 365 e Exchange Online.",
    category: "smtp",
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false, // STARTTLS
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSecure: true,
    authType: "credentials",
    helpTip: "Servidores oficiais do Microsoft 365 / Exchange Online corporativo.",
    stepByStep: [
      "Acesse o Centro de Administração do Microsoft 365 (admin.microsoft.com)",
      "Em Usuários > Usuários Ativos, selecione sua conta",
      "Em 'E-mail' > 'Aplicativos de e-mail', certifique-se de que 'SMTP Autenticado' está marcado",
      "Use seu e-mail corporativo completo e a senha de login",
    ],
  },
  {
    id: "zoho",
    name: "Zoho Mail",
    badge: "Business",
    description: "E-mail corporativo Zoho com criptografia SSL nativa.",
    category: "smtp",
    smtpHost: "smtppro.zoho.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imappro.zoho.com",
    imapPort: 993,
    imapSecure: true,
    authType: "credentials",
    helpTip: "Conexão direta com a nuvem corporativa Zoho Mail com SSL.",
    stepByStep: [
      "Acesse accounts.zoho.com > Segurança",
      "Se tiver autenticação 2FA ativa, gere uma 'Senha de Aplicativo'",
      "Utilize seu e-mail do domínio e a senha gerada",
    ],
  },
  {
    id: "hostinger",
    name: "Hostinger",
    badge: "Hospedagem",
    description: "Servidor seguro SSL 465 da Hostinger / Titan Mail.",
    category: "smtp",
    smtpHost: "smtp.hostinger.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imap.hostinger.com",
    imapPort: 993,
    imapSecure: true,
    authType: "credentials",
    helpTip: "Servidor seguro com criptografia SSL direta na porta 465 da Hostinger.",
    stepByStep: [
      "Acesse o painel hPanel da Hostinger > E-mails",
      "Localize a conta de e-mail criada para seu domínio",
      "Insira o e-mail completo e a senha cadastrada",
    ],
  },
  {
    id: "locaweb",
    name: "Locaweb",
    badge: "Brasil",
    description: "Servidor oficial com certificado SSL da Locaweb.",
    category: "smtp",
    smtpHost: "email-ssl.com.br",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "email-ssl.com.br",
    imapPort: 993,
    imapSecure: true,
    authType: "credentials",
    helpTip: "Servidor oficial de e-mail corporativo da Locaweb com SSL nativo.",
    stepByStep: [
      "Acesse o painel de E-mail da Locaweb",
      "Utilize seu endereço de e-mail completo e senha da caixa postal",
      "A porta 465 SSL já está configurada por padrão",
    ],
  },
  {
    id: "umbler",
    name: "Umbler",
    badge: "Cloud",
    description: "Servidor de envio SMTP otimizado da Umbler.",
    category: "smtp",
    smtpHost: "smtp.umbler.com",
    smtpPort: 587,
    smtpSecure: false, // STARTTLS
    imapHost: "imap.umbler.com",
    imapPort: 993,
    imapSecure: true,
    authType: "credentials",
    helpTip: "Servidores em nuvem otimizados da Umbler com STARTTLS na porta 587.",
    stepByStep: [
      "Acesse o painel da Umbler > E-mail",
      "Utilize o e-mail criado e a respectiva senha da caixa postal",
    ],
  },
  {
    id: "cpanel",
    name: "cPanel / Servidor Próprio",
    badge: "Soberania Total",
    description: "Conexão direta com VPS/Dedicado ou cPanel com SSL.",
    category: "smtp",
    smtpHost: "mail.{domain}",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "mail.{domain}",
    imapPort: 993,
    imapSecure: true,
    authType: "credentials",
    helpTip: "Soberania completa: utiliza o servidor VPS/Dedicado ou cPanel da sua empresa.",
    stepByStep: [
      "Acesse seu cPanel > Contas de E-mail",
      "Clique em 'Conectar dispositivos' para confirmar o host (geralmente mail.seudominio.com)",
      "Utilize o usuário completo e a senha da conta",
    ],
  },
  {
    id: "custom_smtp",
    name: "Servidor Customizado",
    badge: "Avançado",
    description: "Configure qualquer servidor com portas personalizadas.",
    category: "smtp",
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    authType: "credentials",
    helpTip: "Configure manualmente qualquer servidor SMTP/IMAP corporativo.",
    stepByStep: [
      "Informe o Host e a Porta do seu servidor",
      "Selecione se exige SSL direto (465) ou STARTTLS (587)",
      "Preencha o Usuário e a Senha da conta",
    ],
  },
];

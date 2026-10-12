export type SignatureTemplateId =
  | "classic-divider"
  | "compact-right"
  | "compact-left"
  | "corporate-icons"
  | "minimal"
  | "business-card";

export interface SignatureData {
  fullName: string;
  role: string;
  department: string;
  company: string;
  email: string;
  phone: string;
  mobile: string;
  website: string;
  address: string;
  avatarUrl?: string; // Base64 ou Link externo
  logoUrl?: string; // Base64 ou Link externo
  avatarType?: "base64" | "url";
  logoType?: "base64" | "url";
  themeColor?: string; // Cor de destaque corporativa (padrão: #7d0000)
  socials?: {
    linkedin?: string;
    instagram?: string;
    whatsapp?: string;
    website?: string;
    github?: string;
  };
}

export interface SignatureItem {
  id: string;
  title: string; // Ex: "Comercial", "Suporte", "Diretoria"
  isDefault: boolean;
  type: "template" | "html";
  templateId: SignatureTemplateId;
  data: SignatureData;
  customHtml?: string;
  updatedAt: string;
}

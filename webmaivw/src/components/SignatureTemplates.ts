import { SignatureData, SignatureTemplateId } from "@/types/signature";

export interface TemplateDefinition {
  id: SignatureTemplateId;
  name: string;
  description: string;
}

export const SIGNATURE_TEMPLATES: TemplateDefinition[] = [
  {
    id: "classic-divider",
    name: "Clássico com Divisórias",
    description: "Avatar/Logo à esquerda, linha divisória vertical corporativa e dados organizados à direita.",
  },
  {
    id: "corporate-icons",
    name: "Corporativo com Ícones & Linha",
    description: "Layout premium com linha de destaque horizontal e ícones de contato elegantes.",
  },
  {
    id: "compact-left",
    name: "Lado Esquerdo Compacto",
    description: "Foto/Avatar quadrada à esquerda e informações em linhas compactas à direita.",
  },
  {
    id: "compact-right",
    name: "Lado Direito Compacto",
    description: "Dados principais à esquerda e logotipo ou avatar no canto direito.",
  },
  {
    id: "business-card",
    name: "Cartão de Visita Completo",
    description: "Avatar e logotipo da empresa, contatos detalhados e links para redes sociais.",
  },
  {
    id: "minimal",
    name: "Minimalista Executivo",
    description: "Tipografia refinada, sem foto, com linha de destaque e links discretos.",
  },
];

export function renderSignatureHTML(templateId: SignatureTemplateId, data: SignatureData): string {
  const themeColor = data.themeColor || "#7d0000";
  const fullName = data.fullName || "Seu Nome Completo";
  const role = data.role || "Cargo / Função";
  const department = data.department ? ` • ${data.department}` : "";
  const company = data.company ? ` | ${data.company}` : "";
  const phone = data.phone || "";
  const mobile = data.mobile || "";
  const email = data.email || "";
  const website = data.website || "";
  const address = data.address || "";
  const avatar = data.avatarUrl || "";
  const logo = data.logoUrl || "";

  // Helper para redes sociais
  const socialLinks: string[] = [];
  if (data.socials?.linkedin) {
    socialLinks.push(`<a href="${data.socials.linkedin}" target="_blank" rel="noopener noreferrer" style="color: ${themeColor}; text-decoration: none; font-weight: 600; font-size: 11px;">LinkedIn</a>`);
  }
  if (data.socials?.instagram) {
    socialLinks.push(`<a href="${data.socials.instagram}" target="_blank" rel="noopener noreferrer" style="color: ${themeColor}; text-decoration: none; font-weight: 600; font-size: 11px;">Instagram</a>`);
  }
  if (data.socials?.whatsapp) {
    socialLinks.push(`<a href="https://wa.me/${data.socials.whatsapp.replace(/\D/g, "")}" target="_blank" rel="noopener noreferrer" style="color: ${themeColor}; text-decoration: none; font-weight: 600; font-size: 11px;">WhatsApp</a>`);
  }
  if (data.socials?.github) {
    socialLinks.push(`<a href="${data.socials.github}" target="_blank" rel="noopener noreferrer" style="color: ${themeColor}; text-decoration: none; font-weight: 600; font-size: 11px;">GitHub</a>`);
  }
  const socialsHtml = socialLinks.length > 0 ? `<div style="margin-top: 8px; font-size: 11px;">${socialLinks.join(" &bull; ")}</div>` : "";

  // 1. Clássico com Divisórias
  if (templateId === "classic-divider") {
    return `
<table cellpadding="0" cellspacing="0" border="0" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.4; color: #1e293b; max-width: 520px; border-collapse: collapse; margin-top: 16px;">
  <tr>
    ${avatar ? `
    <td valign="middle" style="padding-right: 16px;">
      <img src="${avatar}" alt="${fullName}" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; display: block;" />
      ${logo ? `<img src="${logo}" alt="${data.company || 'Logo'}" style="width: 70px; max-height: 30px; object-fit: contain; margin-top: 8px; display: block;" />` : ""}
    </td>` : ""}
    <td valign="middle" style="${avatar ? `border-left: 3px solid ${themeColor}; padding-left: 16px;` : ""}">
      <div style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 2px;">${fullName}</div>
      <div style="font-size: 12px; color: ${themeColor}; font-weight: 600; margin-bottom: 6px;">${role}${department}${company}</div>
      <div style="font-size: 11px; color: #475569; line-height: 1.6;">
        ${phone || mobile ? `<div><span style="color: ${themeColor}; font-weight: bold;">Tel:</span> ${[phone, mobile].filter(Boolean).join(" | ")}</div>` : ""}
        ${email ? `<div><span style="color: ${themeColor}; font-weight: bold;">E-mail:</span> <a href="mailto:${email}" style="color: #2563eb; text-decoration: none;">${email}</a></div>` : ""}
        ${website ? `<div><span style="color: ${themeColor}; font-weight: bold;">Site:</span> <a href="${website.startsWith('http') ? website : `https://${website}`}" style="color: #2563eb; text-decoration: none;">${website}</a></div>` : ""}
        ${address ? `<div><span style="color: ${themeColor}; font-weight: bold;">End:</span> ${address}</div>` : ""}
      </div>
      ${socialsHtml}
    </td>
  </tr>
</table>`;
  }

  // 2. Corporativo com Ícones & Linha Horizontal
  if (templateId === "corporate-icons") {
    return `
<table cellpadding="0" cellspacing="0" border="0" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.4; color: #1e293b; max-width: 520px; border-collapse: collapse; margin-top: 16px;">
  <tr>
    ${avatar ? `
    <td valign="top" style="padding-right: 16px; padding-top: 2px;">
      <img src="${avatar}" alt="${fullName}" style="width: 76px; height: 76px; border-radius: 50%; object-fit: cover; display: block; border: 2px solid ${themeColor};" />
    </td>` : ""}
    <td valign="top">
      <div style="font-size: 16px; font-weight: 800; color: #0f172a;">${fullName}</div>
      <div style="font-size: 12px; color: #475569; font-weight: 500; margin-top: 1px;">${role}</div>
      <div style="font-size: 11px; font-weight: 700; color: ${themeColor}; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px;">${data.company || "MAIVW Network"} ${department}</div>
      
      <div style="height: 2px; background-color: ${themeColor}; width: 100%; margin: 8px 0;"></div>
      
      <table cellpadding="0" cellspacing="0" border="0" style="font-size: 11px; color: #475569; line-height: 1.6;">
        ${phone || mobile ? `<tr><td style="padding-right: 6px; color: ${themeColor};">&#9742;</td><td>${[phone, mobile].filter(Boolean).join(" &bull; ")}</td></tr>` : ""}
        ${email ? `<tr><td style="padding-right: 6px; color: ${themeColor};">&#9993;</td><td><a href="mailto:${email}" style="color: #1e293b; text-decoration: none; font-weight: 500;">${email}</a></td></tr>` : ""}
        ${website ? `<tr><td style="padding-right: 6px; color: ${themeColor};">&#127760;</td><td><a href="${website.startsWith('http') ? website : `https://${website}`}" style="color: #2563eb; text-decoration: none;">${website}</a></td></tr>` : ""}
        ${address ? `<tr><td style="padding-right: 6px; color: ${themeColor};">&#128205;</td><td>${address}</td></tr>` : ""}
      </table>
      ${socialsHtml}
    </td>
  </tr>
</table>`;
  }

  // 3. Lado Esquerdo Compacto
  if (templateId === "compact-left") {
    return `
<table cellpadding="0" cellspacing="0" border="0" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.4; color: #334155; max-width: 480px; border-collapse: collapse; margin-top: 16px;">
  <tr>
    ${avatar || logo ? `
    <td valign="top" style="padding-right: 14px;">
      <img src="${avatar || logo}" alt="${fullName}" style="width: 64px; height: 64px; border-radius: 8px; object-fit: cover; display: block;" />
    </td>` : ""}
    <td valign="top">
      <div style="font-size: 14px; font-weight: 700; color: #0f172a;">${fullName}</div>
      <div style="font-size: 11px; color: ${themeColor}; font-weight: 600;">${role}${company}</div>
      <div style="margin-top: 4px; color: #64748b; font-size: 11px; line-height: 1.5;">
        ${[phone || mobile, email, website].filter(Boolean).join(" &bull; ")}
      </div>
      ${address ? `<div style="color: #94a3b8; font-size: 10px; margin-top: 2px;">${address}</div>` : ""}
      ${socialsHtml}
    </td>
  </tr>
</table>`;
  }

  // 4. Lado Direito Compacto
  if (templateId === "compact-right") {
    return `
<table cellpadding="0" cellspacing="0" border="0" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.4; color: #334155; max-width: 500px; border-collapse: collapse; margin-top: 16px;">
  <tr>
    <td valign="top" style="padding-right: 16px;">
      <div style="font-size: 14px; font-weight: 700; color: #0f172a;">${fullName}</div>
      <div style="font-size: 11px; color: ${themeColor}; font-weight: 600; margin-bottom: 4px;">${role}${department}${company}</div>
      <div style="color: #64748b; line-height: 1.5;">
        ${[phone || mobile, email].filter(Boolean).join(" | ")}
      </div>
      ${website ? `<div><a href="${website.startsWith('http') ? website : `https://${website}`}" style="color: #2563eb; text-decoration: none;">${website}</a></div>` : ""}
      ${socialsHtml}
    </td>
    ${logo || avatar ? `
    <td valign="middle" style="padding-left: 14px; border-left: 2px solid #e2e8f0;">
      <img src="${logo || avatar}" alt="${data.company || fullName}" style="max-width: 80px; max-height: 60px; object-fit: contain; display: block;" />
    </td>` : ""}
  </tr>
</table>`;
  }

  // 5. Cartão de Visita Completo
  if (templateId === "business-card") {
    return `
<table cellpadding="0" cellspacing="0" border="0" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.4; color: #1e293b; max-width: 540px; border-collapse: collapse; margin-top: 16px; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; background-color: #ffffff;">
  <tr>
    <td style="padding: 12px;">
      <table cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
        <tr>
          ${avatar ? `
          <td valign="middle" style="width: 70px; padding-right: 14px;">
            <img src="${avatar}" alt="${fullName}" style="width: 64px; height: 64px; border-radius: 50%; object-fit: cover; display: block; border: 2px solid ${themeColor};" />
          </td>` : ""}
          <td valign="middle">
            <div style="font-size: 15px; font-weight: 800; color: #0f172a;">${fullName}</div>
            <div style="font-size: 12px; color: ${themeColor}; font-weight: 600;">${role}${company}</div>
          </td>
          ${logo ? `
          <td valign="middle" align="right" style="padding-left: 12px;">
            <img src="${logo}" alt="${data.company || 'Logo'}" style="max-width: 90px; max-height: 40px; object-fit: contain; display: block;" />
          </td>` : ""}
        </tr>
      </table>

      <div style="height: 1px; background-color: #e2e8f0; margin: 10px 0;"></div>

      <div style="font-size: 11px; color: #475569; line-height: 1.6;">
        ${phone || mobile ? `<div>&#9742; ${[phone, mobile].filter(Boolean).join(" &bull; ")}</div>` : ""}
        ${email ? `<div>&#9993; <a href="mailto:${email}" style="color: #2563eb; text-decoration: none;">${email}</a></div>` : ""}
        ${website ? `<div>&#127760; <a href="${website.startsWith('http') ? website : `https://${website}`}" style="color: #2563eb; text-decoration: none;">${website}</a></div>` : ""}
        ${address ? `<div>&#128205; ${address}</div>` : ""}
      </div>
      ${socialsHtml}
    </td>
  </tr>
</table>`;
  }

  // 6. Minimalista Executivo (Padrão)
  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.5; color: #334155; max-width: 480px; margin-top: 16px;">
  <div style="font-size: 14px; font-weight: 700; color: #0f172a;">${fullName}</div>
  <div style="font-size: 11px; color: ${themeColor}; font-weight: 600; margin-bottom: 4px;">${role}${department}${company}</div>
  <div style="height: 2px; width: 40px; background-color: ${themeColor}; margin: 6px 0;"></div>
  <div style="font-size: 11px; color: #64748b;">
    ${[phone || mobile, email, website].filter(Boolean).join(" &bull; ")}
  </div>
  ${address ? `<div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">${address}</div>` : ""}
  ${socialsHtml}
</div>`;
}

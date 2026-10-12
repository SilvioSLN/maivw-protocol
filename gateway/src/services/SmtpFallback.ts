/**
 * SmtpFallback — Fallback para envio via SMTP legado
 * 
 * Quando o domínio de destino NÃO está registrado na rede MAIVW,
 * o Gateway roteia a mensagem para um provedor de e-mail tradicional.
 * 
 * Para o MVP, esta é uma simulação (mock) que apenas loga no console.
 * Em produção, seria substituída pela API do Resend, SendGrid, ou similar.
 */
export class SmtpFallback {
  constructor() {
    console.log("[SMTP FALLBACK] Mock SMTP service initialized");
  }

  /**
   * Simula o envio de uma mensagem via SMTP legado
   * 
   * @param to Endereço de e-mail do destinatário
   * @param subject Assunto da mensagem
   * @param content Conteúdo da mensagem
   * @param senderDomain Domínio do remetente
   * @returns true se o envio simulado foi bem-sucedido
   */
  async sendEmail(
    to: string,
    subject: string,
    content: { text: string; html?: string },
    senderDomain: string
  ): Promise<boolean> {
    console.log("");
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║  📧 SMTP FALLBACK — Envio via protocolo legado             ║");
    console.log("╠══════════════════════════════════════════════════════════════╣");
    console.log(`║  De:      noreply@${senderDomain}`);
    console.log(`║  Para:    ${to}`);
    console.log(`║  Assunto: ${subject}`);
    console.log(`║  Rota:    SMTP Legado (Resend/SendGrid mock)`);
    console.log(`║  Status:  ✅ Enviado com sucesso (simulado)`);
    console.log("╚══════════════════════════════════════════════════════════════╝");
    console.log("");

    // Em produção:
    // const resend = new Resend(process.env.RESEND_API_KEY);
    // await resend.emails.send({
    //   from: `noreply@${senderDomain}`,
    //   to: [to],
    //   subject: subject,
    //   text: content.text,
    //   html: content.html,
    // });

    return true;
  }
}

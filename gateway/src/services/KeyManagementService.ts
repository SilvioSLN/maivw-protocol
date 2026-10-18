import crypto from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { PrismaClient } from "@prisma/client";
import { Keypair } from "@solana/web3.js";

/**
 * KeyManagementService (KMS Mock) — Fase 10
 * 
 * Gerencia o ciclo de vida criptográfico das identidades Web3 de forma totalmente
 * transparente e segura para o usuário final:
 * 1. Gera carteiras EVM quando domínios são criados/verificados.
 * 2. Criptografa chaves privadas com AES-256-GCM usando uma MASTER_SECRET_KEY.
 * 3. Mantém chaves privadas desencriptadas em memória APENAS no momento da assinatura.
 * 4. Gera e valida API Keys no formato `maivw_live_[hash]`.
 */
export class KeyManagementService {
  private prisma: PrismaClient;
  private encryptionKey: Buffer;

  constructor(prisma: PrismaClient, masterSecretKey: string) {
    this.prisma = prisma;
    // Derivação determinística de chave de 32 bytes (256 bits) para AES-256-GCM
    this.encryptionKey = crypto.createHash("sha256").update(masterSecretKey).digest();
  }

  /**
   * Criptografa uma string usando AES-256-GCM.
   */
  private encrypt(plainText: string): { cipherText: string; iv: string; authTag: string } {
    const iv = crypto.randomBytes(12); // 96-bit IV recomendado para GCM
    const cipher = crypto.createCipheriv("aes-256-gcm", this.encryptionKey, iv);

    let cipherText = cipher.update(plainText, "utf8", "hex");
    cipherText += cipher.final("hex");

    const authTag = cipher.getAuthTag().toString("hex");

    return {
      cipherText,
      iv: iv.toString("hex"),
      authTag,
    };
  }

  /**
   * Descriptografa uma string usando AES-256-GCM.
   */
  private decrypt(cipherText: string, ivHex: string, authTagHex: string): string {
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");

    const decipher = crypto.createDecipheriv("aes-256-gcm", this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(cipherText, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  /**
   * Provisiona uma carteira Web3 para um domínio, criptografando a private key no cofre.
   */
  async provisionWalletForDomain(domainId: number): Promise<{ publicKey: Address; vaultId: number }> {
    // 0. Se já existir uma carteira provisionada para este domínio, reutiliza para manter a identidade estável
    const existingVault = await this.prisma.walletVault.findUnique({
      where: { domainId },
    });
    if (existingVault) {
      return {
        publicKey: existingVault.publicKey as Address,
        vaultId: existingVault.id,
      };
    }

    // 1. Gera nova private key criptograficamente segura
    const rawPrivateKey = generatePrivateKey();
    const account = privateKeyToAccount(rawPrivateKey);
    const publicKey = account.address;

    // 2. Criptografa a chave privada com AES-256-GCM
    const { cipherText, iv, authTag } = this.encrypt(rawPrivateKey);

    // 3. Salva no banco de dados (WalletVault)
    const vault = await this.prisma.walletVault.upsert({
      where: { domainId },
      create: {
        domainId,
        publicKey,
        encryptedPrivateKey: cipherText,
        iv,
        authTag,
      },
      update: {
        publicKey,
        encryptedPrivateKey: cipherText,
        iv,
        authTag,
      },
    });

    console.log(`[KMS] Provisioned Web3 Wallet for domainId=${domainId}: ${publicKey} (AES-256-GCM encrypted)`);

    return {
      publicKey: publicKey as Address,
      vaultId: vault.id,
    };
  }

  /**
   * Provisiona uma carteira Ed25519 Solana para um domínio de forma transparente.
   */
  async provisionSolanaWalletForDomain(domainId: number): Promise<{ publicKey: string; vaultId: number }> {
    const existingVault = await this.prisma.walletVault.findUnique({
      where: { domainId },
    });
    // Se a carteira já for uma pubkey Solana base58 (não prefixada com 0x)
    if (existingVault && !existingVault.publicKey.startsWith("0x")) {
      return {
        publicKey: existingVault.publicKey,
        vaultId: existingVault.id,
      };
    }

    const keypair = Keypair.generate();
    const publicKey = keypair.publicKey.toBase58();
    const secretKeyBase64 = Buffer.from(keypair.secretKey).toString("base64");

    const { cipherText, iv, authTag } = this.encrypt(secretKeyBase64);

    const vault = await this.prisma.walletVault.upsert({
      where: { domainId },
      create: {
        domainId,
        publicKey,
        encryptedPrivateKey: cipherText,
        iv,
        authTag,
      },
      update: {
        publicKey,
        encryptedPrivateKey: cipherText,
        iv,
        authTag,
      },
    });

    console.log(`[KMS] Provisioned Solana Keypair for domainId=${domainId}: ${publicKey} (AES-256-GCM encrypted)`);

    return {
      publicKey,
      vaultId: vault.id,
    };
  }

  /**
   * Recupera o keypair Solana de um domínio descriptografando a chave privada.
   */
  async getSolanaSignerForDomain(domainNameOrId: string | number): Promise<Keypair> {
    let vault = null;
    if (typeof domainNameOrId === "number") {
      vault = await this.prisma.walletVault.findUnique({ where: { domainId: domainNameOrId } });
    } else {
      const domain = await this.prisma.domain.findUnique({
        where: { domainName: domainNameOrId.toLowerCase().trim() },
        include: { walletVault: true },
      });
      vault = domain?.walletVault;
    }

    if (!vault) {
      throw new Error(`[KMS] No wallet vault found for domain "${domainNameOrId}"`);
    }

    const decrypted = this.decrypt(vault.encryptedPrivateKey, vault.iv, vault.authTag);
    return Keypair.fromSecretKey(Buffer.from(decrypted, "base64"));
  }

  /**
   * Recupera o assinante (Account) de um domínio descriptografando a chave privada temporariamente na memória.
   */
  async getSignerForDomain(domainNameOrId: string | number) {
    let vault = null;

    if (typeof domainNameOrId === "number") {
      vault = await this.prisma.walletVault.findUnique({
        where: { domainId: domainNameOrId },
      });
    } else {
      const domain = await this.prisma.domain.findUnique({
        where: { domainName: domainNameOrId.toLowerCase().trim() },
        include: { walletVault: true },
      });
      vault = domain?.walletVault;
    }

    if (!vault) {
      throw new Error(`[KMS] No wallet vault found for domain "${domainNameOrId}"`);
    }

    // Descriptografa na memória apenas para a assinatura
    const decryptedPrivateKey = this.decrypt(vault.encryptedPrivateKey, vault.iv, vault.authTag);
    return privateKeyToAccount(decryptedPrivateKey as Hex);
  }

  /**
   * Gera uma nova API Key no formato `maivw_live_[hash]` e armazena apenas o hash SHA-256.
   */
  async generateApiKey(
    domainId: number,
    name: string,
    environment: "production" | "staging" = "production"
  ): Promise<{ apiKey: string; id: number; name: string }> {
    const prefix = environment === "production" ? "maivw_live_" : "maivw_test_";
    const randomHex = crypto.randomBytes(16).toString("hex");
    const rawApiKey = `${prefix}${randomHex}`;

    // Armazena apenas o hash SHA-256 no banco
    const keyHash = crypto.createHash("sha256").update(rawApiKey).digest("hex");

    const record = await this.prisma.apiKey.create({
      data: {
        keyHash,
        domainId,
        name: name.trim(),
        environment,
      },
    });

    console.log(`[KMS] Generated API Key "${name}" for domainId=${domainId} (ID: ${record.id})`);

    // Retorna a chave em texto plano apenas uma vez
    return {
      apiKey: rawApiKey,
      id: record.id,
      name: record.name,
    };
  }

  /**
   * Valida uma API Key a partir do Bearer token fornecido no header HTTP.
   */
  async validateApiKey(plainApiKey: string): Promise<{ domainId: number; domainName: string; keyName: string } | null> {
    if (!plainApiKey || (!plainApiKey.startsWith("maivw_live_") && !plainApiKey.startsWith("maivw_test_"))) {
      return null;
    }

    const keyHash = crypto.createHash("sha256").update(plainApiKey.trim()).digest("hex");

    const record = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      include: { domain: true },
    });

    if (!record) {
      return null;
    }

    // Atualiza data do último uso de forma assíncrona
    this.prisma.apiKey
      .update({
        where: { id: record.id },
        data: { lastUsedAt: new Date() },
      })
      .catch((err: any) => console.error("[KMS] Error updating lastUsedAt:", err));

    return {
      domainId: record.domainId,
      domainName: record.domain.domainName,
      keyName: record.name,
    };
  }
}

import type { KeyIdentityPolicy, SignerKeyRole } from "./types.js";

export const KEY_IDENTITY_POLICIES: Record<SignerKeyRole, KeyIdentityPolicy> = {
  operational: {
    role: "operational",
    description: "Assinador de trânsito do nó (envelopes P2P v2.0, mTLS DANE e autenticação entre nós)",
    allowedFamilies: ["EVM"],
    allowedProviders: ["local", "gcp-kms", "aws-kms"],
    canHoldPrivateMaterialInGateway: true,
  },
  oracle: {
    role: "oracle",
    description: "Atestações criptográficas de estado, moderação semântica e verificação de claims",
    allowedFamilies: ["EVM"],
    allowedProviders: ["local", "gcp-kms", "aws-kms"],
    canHoldPrivateMaterialInGateway: true,
  },
  relayer: {
    role: "relayer",
    description: "Assinador de transações de espelho multichain cross-network",
    allowedFamilies: ["EVM", "SOLANA"],
    allowedProviders: ["local", "gcp-kms", "aws-kms", "solana-keypair", "solana-envelope"],
    canHoldPrivateMaterialInGateway: true,
  },
  deployer: {
    role: "deployer",
    description: "Identidade exclusiva de esteira CI/CD para deploy e migrações de contratos inteligentes",
    allowedFamilies: ["EVM"],
    allowedProviders: ["local", "aws-kms"],
    canHoldPrivateMaterialInGateway: false, // Proibido no container de produção
  },
  treasury: {
    role: "treasury",
    description: "Cofre Safe multisig para recebimento de taxas, saques e depósitos de stake",
    allowedFamilies: ["EVM", "SOLANA"],
    allowedProviders: [], // Nunca possui chave privada no Gateway
    canHoldPrivateMaterialInGateway: false,
  },
  guardian: {
    role: "guardian",
    description: "Autoridade de segurança para pausa de emergência e veto de slashes abusivos",
    allowedFamilies: ["EVM"],
    allowedProviders: ["local", "aws-kms"],
    canHoldPrivateMaterialInGateway: false, // Separado estritamente do nó operacional
  },
};

export function validateIdentityPolicy(
  role: SignerKeyRole,
  environment: string,
  hasPrivateKey: boolean,
): { valid: boolean; reason?: string } {
  const policy = KEY_IDENTITY_POLICIES[role];
  if (!policy) {
    return { valid: false, reason: `Unknown signer role: ${role}` };
  }

  if (hasPrivateKey && !policy.canHoldPrivateMaterialInGateway && environment !== "local") {
    return {
      valid: false,
      reason: `Role ${role} is not permitted to hold private key material in Gateway runtime outside local dev`,
    };
  }

  return { valid: true };
}

export function assertGatewayIdentityAllowed(
  role: SignerKeyRole,
  environment: string,
  hasPrivateKey: boolean,
): void {
  const result = validateIdentityPolicy(role, environment, hasPrivateKey);
  if (!result.valid) {
    throw new Error(`[SECURITY] Identity policy violation: ${result.reason}`);
  }
}

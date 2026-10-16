import {
  PublicKey,
  Secp256k1Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { hexToBytes, recoverAddress, type Hex } from "viem";
import type { OriginClaimIssuanceRow } from "./OriginReservation.js";

const REGISTER_DOMAIN_DISCRIMINATOR = Buffer.from([236, 7, 208, 151, 173, 149, 73, 104]);
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function fixed(value: string): Buffer {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("expected bytes32");
  return Buffer.from(value.slice(2), "hex");
}
function borshString(value: string): Buffer {
  const data = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4); length.writeUInt32LE(data.length);
  return Buffer.concat([length, data]);
}
function borshVec(value: Uint8Array): Buffer {
  const length = Buffer.alloc(4); length.writeUInt32LE(value.length);
  return Buffer.concat([length, value]);
}
function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
}

export interface SolanaRegistrationTransactionInput {
  programId: string;
  registrant: string;
  registrantTokenAccount: string;
  mint: string;
  domain: string;
  domainHash: Hex;
  endpoint: string;
  operationalKey: Hex;
  adminKey: Hex;
  tlsFingerprint: Hex;
  claim: OriginClaimIssuanceRow;
}

export interface SolanaInstructionDraft {
  programId: string;
  keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  dataBase64: string;
}

export interface SolanaRegistrationTransactionDraft {
  family: "SOLANA";
  feePayer: string;
  requiredSigners: string[];
  instructions: SolanaInstructionDraft[];
  accounts: {
    config: string;
    domainRecord: string;
    claimReceipt: string;
    stakeVault: string;
    founderVault: string;
    treasuryVault: string;
    stakeVaultToken: string;
  };
  claimDigest: string;
  deadline: string;
}

function draft(instruction: TransactionInstruction): SolanaInstructionDraft {
  return {
    programId: instruction.programId.toBase58(),
    keys: instruction.keys.map((key) => ({
      pubkey: key.pubkey.toBase58(), isSigner: key.isSigner, isWritable: key.isWritable,
    })),
    dataBase64: Buffer.from(instruction.data).toString("base64"),
  };
}

/** Builds the two ordered instructions; the client supplies blockhash and signature. */
export async function buildSolanaOriginRegistrationTransaction(
  input: SolanaRegistrationTransactionInput,
): Promise<SolanaRegistrationTransactionDraft> {
  const programId = new PublicKey(input.programId);
  const registrant = new PublicKey(input.registrant);
  const registrantToken = new PublicKey(input.registrantTokenAccount);
  const mint = new PublicKey(input.mint);
  if (input.claim.domainHash.toLowerCase() !== input.domainHash.toLowerCase()) {
    throw new Error("origin claim does not belong to domain");
  }
  const signature = Buffer.from(hexToBytes(input.claim.signature as Hex));
  if (signature.length !== 65) throw new Error("origin claim signature must contain recovery id");
  const rawRecovery = signature[64];
  const recoveryId = rawRecovery >= 27 ? rawRecovery - 27 : rawRecovery;
  if (recoveryId > 1) throw new Error("origin claim recovery id must be 0 or 1");
  const signer = await recoverAddress({ hash: input.claim.digest as Hex, signature: input.claim.signature as Hex });
  const envelope = Buffer.from(hexToBytes(input.claim.encoded as Hex));
  const verify = Secp256k1Program.createInstructionWithEthAddress({
    ethAddress: signer,
    message: envelope,
    signature: signature.subarray(0, 64),
    recoveryId,
    instructionIndex: 0,
  });
  const domainHash = fixed(input.domainHash);
  const nonce = fixed(input.claim.nonce);
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("registry-config")], programId);
  const [domainRecord] = PublicKey.findProgramAddressSync([Buffer.from("domain"), domainHash], programId);
  const [claimReceipt] = PublicKey.findProgramAddressSync([Buffer.from("origin-claim"), domainHash, nonce], programId);
  const [stakeVault] = PublicKey.findProgramAddressSync([Buffer.from("stake-vault"), domainHash], programId);
  const [founderAuthority] = PublicKey.findProgramAddressSync([Buffer.from("founder-vault")], programId);
  const [treasuryAuthority] = PublicKey.findProgramAddressSync([Buffer.from("treasury-vault")], programId);
  const founderVault = ata(founderAuthority, mint);
  const treasuryVault = ata(treasuryAuthority, mint);
  const stakeVaultToken = ata(stakeVault, mint);
  const args = Buffer.concat([
    domainHash, nonce, borshString(input.domain), borshString(input.endpoint),
    fixed(input.operationalKey), fixed(input.adminKey), fixed(input.tlsFingerprint),
  ]);
  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: registrant, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: domainRecord, isSigner: false, isWritable: true },
      { pubkey: claimReceipt, isSigner: false, isWritable: true },
      { pubkey: stakeVault, isSigner: false, isWritable: true },
      { pubkey: registrantToken, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: founderAuthority, isSigner: false, isWritable: false },
      { pubkey: founderVault, isSigner: false, isWritable: true },
      { pubkey: treasuryAuthority, isSigner: false, isWritable: false },
      { pubkey: treasuryVault, isSigner: false, isWritable: true },
      { pubkey: stakeVaultToken, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([REGISTER_DOMAIN_DISCRIMINATOR, args, borshVec(envelope)]),
  });
  return {
    family: "SOLANA",
    feePayer: registrant.toBase58(),
    requiredSigners: [registrant.toBase58()],
    instructions: [draft(verify), draft(instruction)],
    accounts: {
      config: config.toBase58(), domainRecord: domainRecord.toBase58(), claimReceipt: claimReceipt.toBase58(),
      stakeVault: stakeVault.toBase58(), founderVault: founderVault.toBase58(),
      treasuryVault: treasuryVault.toBase58(), stakeVaultToken: stakeVaultToken.toBase58(),
    },
    claimDigest: input.claim.digest,
    deadline: input.claim.deadline.toISOString(),
  };
}

import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { hexToBytes, keccak256, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const INITIALIZE_REGISTRY_DISCRIMINATOR = Buffer.from([189, 181, 20, 17, 174, 57, 249, 59]);
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const REGISTRY_CONFIG_SEED = Buffer.from("registry-config");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function keypair(path: string): Keypair {
  const bytes = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function u64(value: bigint): Buffer {
  const encoded = Buffer.alloc(8);
  encoded.writeBigUInt64LE(value);
  return encoded;
}

function tier(requiredStake: bigint, dailyLimit: bigint, penaltyPerStrike: bigint): Buffer {
  return Buffer.concat([u64(requiredStake), u64(dailyLimit), u64(penaltyPerStrike)]);
}

function decodeRegistryConfig(data: Buffer): Record<string, unknown> {
  let offset = 8;
  const bytes = (length: number): Buffer => {
    const value = data.subarray(offset, offset + length);
    offset += length;
    return value;
  };
  const byte = (): number => bytes(1)[0];
  const uint16 = (): number => {
    const value = data.readUInt16LE(offset);
    offset += 2;
    return value;
  };
  const uint64 = (): string => {
    const value = data.readBigUInt64LE(offset).toString();
    offset += 8;
    return value;
  };
  const publicKey = (): string => new PublicKey(bytes(32)).toBase58();
  const tierConfig = (): Record<string, string> => ({
    requiredStake: uint64(),
    dailyLimit: uint64(),
    penaltyPerStrike: uint64(),
  });

  const schemaVersion = uint16();
  const bump = byte();
  const active = byte() !== 0;
  const authority = publicKey();
  const guardian = publicKey();
  const oracleKey = new PublicKey(bytes(32)).toBase58();
  const attestationSigner = `0x${bytes(20).toString("hex")}`;
  const assetMint = publicKey();
  const tokenProgram = publicKey();
  const assetDecimals = byte();
  const treasury = publicKey();
  const founder = publicKey();
  const networkHash = `0x${bytes(32).toString("hex")}`;
  const standardFee = uint64();
  const providerFee = uint64();
  const mirrorFee = uint64();
  const slashDelaySeconds = uint64();
  const recoveryDelaySeconds = uint64();
  const tiers = [tierConfig(), tierConfig(), tierConfig()];
  const createdAt = data.readBigInt64LE(offset).toString();

  return {
    schemaVersion, bump, active, authority, guardian, oracleKey, attestationSigner,
    assetMint, tokenProgram, assetDecimals, treasury, founder, networkHash,
    standardFee, providerFee, mirrorFee, slashDelaySeconds, recoveryDelaySeconds,
    tiers, createdAt,
  };
}

async function main(): Promise<void> {
  const connection = new Connection(required("SOLANA_RPC_URL"), "confirmed");
  const programId = new PublicKey(required("SOLANA_PROGRAM_ID"));
  const mint = new PublicKey(required("SOLANA_ASSET_MINT"));
  const authority = keypair(required("SOLANA_RELAYER_KEYPAIR_PATH"));
  const guardian = keypair(required("SOLANA_GUARDIAN_KEYPAIR_PATH")).publicKey;
  const treasury = keypair(required("SOLANA_TREASURY_KEYPAIR_PATH")).publicKey;
  const founder = keypair(required("SOLANA_FOUNDER_KEYPAIR_PATH")).publicKey;
  const genesisHash = required("SOLANA_GENESIS_HASH");
  const rawOracleKey = required("ORACLE_PRIVATE_KEY");
  const oraclePrivateKey = (rawOracleKey.startsWith("0x") ? rawOracleKey : `0x${rawOracleKey}`) as Hex;
  const attestationSigner = Buffer.from(hexToBytes(privateKeyToAccount(oraclePrivateKey).address));
  const networkHash = Buffer.from(hexToBytes(keccak256(stringToHex(`solana:${genesisHash}`))));
  const [config] = PublicKey.findProgramAddressSync([REGISTRY_CONFIG_SEED], programId);

  const existing = await connection.getAccountInfo(config, "confirmed");
  if (existing) {
    process.stdout.write(`${JSON.stringify({
      status: "already-initialized",
      config: config.toBase58(),
      owner: existing.owner.toBase58(),
      state: decodeRegistryConfig(existing.data),
    })}\n`);
    return;
  }

  const data = Buffer.concat([
    INITIALIZE_REGISTRY_DISCRIMINATOR,
    guardian.toBuffer(),
    authority.publicKey.toBuffer(),
    attestationSigner,
    treasury.toBuffer(),
    founder.toBuffer(),
    networkHash,
    u64(1_000_000n),
    u64(5_000_000n),
    u64(3_000_000n),
    u64(48n * 60n * 60n),
    u64(72n * 60n * 60n),
    tier(10_000_000n, 50_000n, 500_000n),
    tier(100_000_000n, 1_000_000n, 500_000n),
    tier(1_000_000_000n, 1_000_000_000n, 500_000n),
  ]);

  const instruction = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(instruction),
    [authority],
    { commitment: "confirmed", maxRetries: 10 },
  );
  const created = await connection.getAccountInfo(config, "confirmed");
  if (!created) throw new Error("registry config was not found after initialization");
  process.stdout.write(`${JSON.stringify({
    status: "initialized",
    config: config.toBase58(),
    signature,
    owner: created.owner.toBase58(),
    state: decodeRegistryConfig(created.data),
  })}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

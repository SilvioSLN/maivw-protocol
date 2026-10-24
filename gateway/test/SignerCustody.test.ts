import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, recoverAddress, type Hex } from "viem";
import { Keypair, PublicKey } from "@solana/web3.js";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  LocalEvmSigner,
  AwsKmsEvmSigner,
  AwsKmsSolanaSigner,
  LocalSolanaSigner,
  EnvelopeSolanaSigner,
  SignerFactory,
  CANONICAL_TEST_VECTORS,
  KEY_IDENTITY_POLICIES,
  validateIdentityPolicy,
  sanitizeForLog,
  assertNoPrivateMaterial,
  containsPrivateKeyMaterial,
  redactSecret,
} from "../src/signer/index.js";

const TEST_PRIVATE_KEY_EVM: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDRESS_EVM = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

test("LocalEvmSigner signs messages, digests and preserves secret redaction", async () => {
  const signer = new LocalEvmSigner(TEST_PRIVATE_KEY_EVM, "operational");

  assert.equal(await signer.getAddress(), TEST_ADDRESS_EVM);
  assert.equal(signer.metadata.role, "operational");
  assert.equal(signer.metadata.family, "EVM");
  assert.equal(signer.metadata.provider, "local");

  // Sign and verify text message (EIP-191)
  const message = "Hello MAIVW Decentralized Identity";
  const signature = await signer.signMessage(message);
  assert.ok(signature.startsWith("0x"));
  assert.equal(signature.length, 132); // 65 bytes = 130 hex + 2 (0x)

  const isValidMsg = await signer.verify(message, signature);
  assert.equal(isValidMsg, true);

  // Sign and verify 32-byte digest
  const digest = keccak256(Buffer.from(message));
  const digestSig = await signer.signDigest(digest);
  const recovered = await recoverAddress({ hash: digest, signature: digestSig });
  assert.equal(recovered.toLowerCase(), TEST_ADDRESS_EVM.toLowerCase());

  const isValidDigest = await signer.verify(digest, digestSig);
  assert.equal(isValidDigest, true);

  // Secret safety: toJSON and inspect do not expose private key
  const json = signer.toJSON();
  assert.equal("privateKey" in json, false);
  assert.equal(JSON.stringify(json).includes(TEST_PRIVATE_KEY_EVM.slice(2)), false);
  assertNoPrivateMaterial(json, "LocalEvmSigner.toJSON");
});

test("AwsKmsEvmSigner normalizes DER, resolves recovery id and signs remotely", async () => {
  // Setup a mock AWS KMS transport backed by native crypto ECDSA secp256k1
  const ec = crypto.generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  const spkiDer = ec.publicKey.export({ format: "der", type: "spki" });
  const privRaw = (ec.privateKey.export({ format: "jwk" }) as any).d;
  const privBytes = Buffer.from(privRaw, "base64url");

  const mockTransport = {
    async getPublicKey(_keyId: string) {
      return spkiDer;
    },
    async signDigest(_keyId: string, digest: Uint8Array) {
      // Returns standard ASN.1 DER signature as AWS KMS does
      const sigObj = secp256k1.sign(digest, privBytes);
      return Buffer.from(sigObj.toDERRawBytes());
    },
  };

  const signer = new AwsKmsEvmSigner({
    keyId: "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012",
    role: "oracle",
    transport: mockTransport,
  });

  const address = await signer.getAddress();
  assert.ok(address.startsWith("0x"));
  assert.equal(address.length, 42);

  const digest = keccak256(Buffer.from("MAIVW_AWS_KMS_EVM_SIGNER_TEST"));
  const sig = await signer.signDigest(digest);
  assert.ok(sig.startsWith("0x"));
  assert.equal(sig.length, 132); // 65 bytes canonical EVM signature

  const recovered = await recoverAddress({ hash: digest, signature: sig });
  assert.equal(recovered.toLowerCase(), address.toLowerCase());

  const verified = await signer.verify(digest, sig);
  assert.equal(verified, true);

  // Secret safety
  assertNoPrivateMaterial(signer.toJSON(), "AwsKmsEvmSigner.toJSON");
});

test("LocalSolanaSigner signs and verifies Ed25519 detached signatures without leaking keypair", async () => {
  const seed = new Uint8Array(32).fill(7);
  const keypair = Keypair.fromSeed(seed);
  const signer = new LocalSolanaSigner(keypair, "relayer");

  const address = await signer.getAddress();
  assert.equal(address, keypair.publicKey.toBase58());
  assert.equal(signer.metadata.family, "SOLANA");

  const message = "SOLANA_CROSS_CHAIN_ATTESTATION_PAYLOAD";
  const signatureBase64 = await signer.signMessage(message);
  assert.ok(signatureBase64.length > 0);

  const verified = await signer.verify(message, signatureBase64);
  assert.equal(verified, true);

  const tampered = await signer.verify("ALTERED_PAYLOAD", signatureBase64);
  assert.equal(tampered, false);

  // Secret safety
  const json = signer.toJSON();
  assert.equal("secretKey" in json, false);
  assertNoPrivateMaterial(json, "LocalSolanaSigner.toJSON");
});

test("AwsKmsSolanaSigner signs Solana-compatible Ed25519 messages without exporting a keypair", async () => {
  const ed25519 = crypto.generateKeyPairSync("ed25519");
  const spkiDer = ed25519.publicKey.export({ format: "der", type: "spki" });
  const calls: Array<{ operation: string; keyId: string; bytes?: number }> = [];
  const transport = {
    async getPublicKey(keyId: string) {
      calls.push({ operation: "getPublicKey", keyId });
      return spkiDer;
    },
    async signRaw(keyId: string, message: Uint8Array) {
      calls.push({ operation: "signRaw", keyId, bytes: message.byteLength });
      return crypto.sign(null, Buffer.from(message), ed25519.privateKey);
    },
  };

  const keyId = "alias/maivw-staging-solana-relayer-signer";
  const signer = new AwsKmsSolanaSigner({ keyId, role: "relayer", transport });
  const message = "MAIVW_SOLANA_KMS_ED25519_VECTOR";
  const address = await signer.getAddress();
  const signature = await signer.signMessage(message);

  assert.equal(new PublicKey(address).toBase58(), address);
  assert.equal(Buffer.from(signature, "base64").length, 64);
  assert.equal(await signer.verify(message, signature), true);
  assert.equal(await signer.verify(`${message}_tampered`, signature), false);
  assert.deepEqual(calls, [
    { operation: "getPublicKey", keyId },
    { operation: "signRaw", keyId, bytes: Buffer.byteLength(message) },
  ]);
  assertNoPrivateMaterial(signer.toJSON(), "AwsKmsSolanaSigner.toJSON");

  const factorySigner = SignerFactory.createSolanaRelayerSigner({
    SOLANA_RELAYER_SIGNER_TYPE: "aws-kms",
    SOLANA_RELAYER_KMS_KEY_ID: keyId,
    SOLANA_RELAYER_KEYPAIR_PATH: undefined,
    SOLANA_RELAYER_KEYPAIR_BASE64: undefined,
  }, { awsKmsSolanaTransport: transport });
  assert.ok(factorySigner instanceof AwsKmsSolanaSigner);

  await assert.rejects(
    signer.signMessage(new Uint8Array(4097)),
    /exceeds 4096 bytes/,
  );
});

test("EnvelopeSolanaSigner performs envelope encryption and signs on demand", async () => {
  const keypair = Keypair.generate();
  const masterSecret = "super-secure-master-secret-key-for-envelope-testing-32b";

  const { signer, envelope } = EnvelopeSolanaSigner.createEncrypted(
    keypair,
    masterSecret,
    "relayer",
  );

  // Ciphertext must be encrypted
  assert.ok(envelope.cipherText.length > 0);
  assert.ok(envelope.iv.length === 24); // 12 bytes = 24 hex
  assert.ok(envelope.authTag.length === 32); // 16 bytes = 32 hex
  assert.equal(envelope.cipherText.includes(keypair.publicKey.toBase58()), false);

  const address = await signer.getAddress();
  assert.equal(address, keypair.publicKey.toBase58());

  // Sign message using envelope decryption on demand
  const message = "ENVELOPE_PROTECTED_SOLANA_SIGNATURE";
  const signature = await signer.signMessage(message);
  assert.ok(signature.length > 0);

  const valid = await signer.verify(message, signature);
  assert.equal(valid, true);

  // Corrupted master secret fails decryption
  const badSigner = new EnvelopeSolanaSigner(
    envelope,
    "wrong-master-secret-password-123456",
    keypair.publicKey.toBase58(),
    "relayer",
  );
  await assert.rejects(badSigner.signMessage(message));

  // Secret safety
  assertNoPrivateMaterial(signer.toJSON(), "EnvelopeSolanaSigner.toJSON");
});

test("Canonical test vectors match exactly and verify cross-family signatures", async () => {
  for (const vector of CANONICAL_TEST_VECTORS) {
    if (vector.family === "EVM") {
      const recovered = await recoverAddress({
        hash: vector.digest as Hex,
        signature: vector.signature as Hex,
      });
      assert.equal(
        recovered.toLowerCase(),
        vector.publicKey.toLowerCase(),
        `Vector ${vector.id} must recover expected EVM public address`,
      );
    } else if (vector.family === "SOLANA") {
      const { ed25519PublicKeyFromBytes } = await import("../src/signer/LocalSolanaSigner.js");
      const { PublicKey } = await import("@solana/web3.js");
      const pubBytes = new PublicKey(vector.publicKey).toBytes();
      const pubKeyObj = ed25519PublicKeyFromBytes(pubBytes);
      const data = Buffer.from(vector.payload, "utf8");
      const sigBytes = Buffer.from(vector.signature, "base64");
      const ok = crypto.verify(null, data, pubKeyObj, sigBytes);
      assert.equal(ok, true, `Vector ${vector.id} must verify with Ed25519`);
    }
  }
});

test("Key identity policy enforces role separation and prevents critical custody leakage", () => {
  // Treasury must never hold private keys in Gateway
  const treasuryCheck = validateIdentityPolicy("treasury", "production", true);
  assert.equal(treasuryCheck.valid, false);

  // Guardian must never hold private keys in Gateway
  const guardianCheck = validateIdentityPolicy("guardian", "production", true);
  assert.equal(guardianCheck.valid, false);

  // Deployer must not hold private keys in Gateway in production
  const deployerProdCheck = validateIdentityPolicy("deployer", "production", true);
  assert.equal(deployerProdCheck.valid, false);

  // Operational is allowed in Gateway
  const operationalCheck = validateIdentityPolicy("operational", "production", true);
  assert.equal(operationalCheck.valid, true);

  // Oracle is allowed in Gateway
  const oracleCheck = validateIdentityPolicy("oracle", "production", true);
  assert.equal(oracleCheck.valid, true);

  // Treasury has zero allowed private providers
  assert.deepEqual(KEY_IDENTITY_POLICIES.treasury.allowedProviders, []);
  assert.equal(KEY_IDENTITY_POLICIES.treasury.canHoldPrivateMaterialInGateway, false);
  assert.equal(KEY_IDENTITY_POLICIES.guardian.canHoldPrivateMaterialInGateway, false);
});

test("Sanitization masks private keys and prevents credential leaks in logs", () => {
  const sensitiveObj = {
    service: "maivw-gateway",
    role: "oracle",
    oraclePrivateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    nested: {
      secretToken: "secret_value_12345",
      address: TEST_ADDRESS_EVM,
      rawHexKey: "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    },
  };

  const sanitized = sanitizeForLog(sensitiveObj) as any;
  assert.equal(sanitized.oraclePrivateKey, "[REDACTED]");
  assert.equal(sanitized.nested.secretToken, "[REDACTED]");
  assert.equal(sanitized.nested.address, TEST_ADDRESS_EVM);
  assert.equal(containsPrivateKeyMaterial(JSON.stringify(sanitized)), false);

  assert.equal(containsPrivateKeyMaterial(TEST_PRIVATE_KEY_EVM), true);
  assert.equal(containsPrivateKeyMaterial(TEST_ADDRESS_EVM), false);
  assert.ok(redactSecret(TEST_PRIVATE_KEY_EVM).includes("[REDACTED]"));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import type { KMSClient } from "@aws-sdk/client-kms";
import {
  AwsSdkKmsSolanaTransport,
  AwsSdkKmsTransport,
} from "../src/services/AwsKmsAccount.js";

test("AwsSdkKmsTransport uses public-key lookup and digest-only secp256k1 signing", async () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const client = {
    async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      calls.push({ name: command.constructor.name, input: command.input });
      if (command.constructor.name === "GetPublicKeyCommand") return { PublicKey: Uint8Array.of(1, 2, 3) };
      return { Signature: Uint8Array.of(4, 5, 6) };
    },
  } as unknown as KMSClient;
  const transport = new AwsSdkKmsTransport(client);

  assert.deepEqual(await transport.getPublicKey("alias/oracle"), Uint8Array.of(1, 2, 3));
  assert.deepEqual(await transport.signDigest("alias/oracle", new Uint8Array(32)), Uint8Array.of(4, 5, 6));
  assert.deepEqual(calls, [
    { name: "GetPublicKeyCommand", input: { KeyId: "alias/oracle" } },
    {
      name: "SignCommand",
      input: {
        KeyId: "alias/oracle",
        Message: new Uint8Array(32),
        MessageType: "DIGEST",
        SigningAlgorithm: "ECDSA_SHA_256",
      },
    },
  ]);
});

test("AwsSdkKmsSolanaTransport uses RAW ED25519_SHA_512 signing", async () => {
  const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const client = {
    async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      calls.push({ name: command.constructor.name, input: command.input });
      if (command.constructor.name === "GetPublicKeyCommand") {
        return {
          PublicKey: Uint8Array.of(1, 2, 3),
          KeySpec: "ECC_NIST_EDWARDS25519",
          KeyUsage: "SIGN_VERIFY",
          SigningAlgorithms: ["ED25519_SHA_512"],
        };
      }
      return { Signature: new Uint8Array(64).fill(7) };
    },
  } as unknown as KMSClient;
  const transport = new AwsSdkKmsSolanaTransport(client);
  const message = new TextEncoder().encode("solana-message");

  assert.deepEqual(await transport.getPublicKey("alias/solana"), Uint8Array.of(1, 2, 3));
  assert.deepEqual(await transport.signRaw("alias/solana", message), new Uint8Array(64).fill(7));
  assert.deepEqual(calls, [
    { name: "GetPublicKeyCommand", input: { KeyId: "alias/solana" } },
    {
      name: "SignCommand",
      input: {
        KeyId: "alias/solana",
        Message: message,
        MessageType: "RAW",
        SigningAlgorithm: "ED25519_SHA_512",
      },
    },
  ]);
});

test("AwsSdkKmsSolanaTransport rejects incompatible KMS key metadata", async () => {
  const client = {
    async send() {
      return {
        PublicKey: Uint8Array.of(1),
        KeySpec: "ECC_SECG_P256K1",
        KeyUsage: "SIGN_VERIFY",
      };
    },
  } as unknown as KMSClient;

  await assert.rejects(
    new AwsSdkKmsSolanaTransport(client).getPublicKey("alias/wrong-key"),
    /Expected ECC_NIST_EDWARDS25519/,
  );
});

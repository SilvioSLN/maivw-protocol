import { test } from "node:test";
import assert from "node:assert/strict";
import type { KMSClient } from "@aws-sdk/client-kms";
import { AwsSdkKmsTransport } from "../src/services/AwsKmsAccount.js";

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

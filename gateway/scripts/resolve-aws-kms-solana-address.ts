import { createAwsKmsSolanaSigner } from "../src/services/AwsKmsAccount.js";

const keyId = process.env.SOLANA_RELAYER_KMS_KEY_ID;
if (!keyId) {
  throw new Error("SOLANA_RELAYER_KMS_KEY_ID is required");
}

const signer = createAwsKmsSolanaSigner({
  keyId,
  region: process.env.AWS_REGION,
});

console.log(await signer.getAddress());

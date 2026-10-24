import { AwsKmsOracleSigner } from "../src/services/AwsKmsAccount.js";

const keyId = process.env.AWS_KMS_KEY_ID?.trim();
if (!keyId) throw new Error("AWS_KMS_KEY_ID is required");

const signer = new AwsKmsOracleSigner({
  keyId,
  region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
});

console.log(await signer.getAddress());

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  parseDerSignature,
  GcpKmsOracleSigner,
  createGcpKmsAccount,
} from "../src/services/GcpKmsAccount.js";
import {
  recoverAddress,
  hashTypedData,
  parseTransaction,
  toHex,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

describe("Google Cloud KMS Signer & Account", () => {
  // Chave de teste conhecida (Anvil Account 0)
  const TEST_PRIV_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const EXPECTED_ADDRESS: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  const testAccount = privateKeyToAccount(TEST_PRIV_KEY);

  // Cria objeto de chave Crypto nativo para mockar o Cloud HSM
  const ecKey = crypto.createPrivateKey({
    key: Buffer.from("302e0201010420" + TEST_PRIV_KEY.slice(2) + "a00706052b8104000a", "hex"),
    format: "der",
    type: "sec1",
  });
  const pubKey = crypto.createPublicKey(ecKey);
  const testPem = pubKey.export({ type: "spki", format: "pem" }) as string;

  /**
   * Converte (r, s) em formato ASN.1 DER exatamente como retornado pelo Google Cloud KMS.
   */
  function rawSigToDer(rHex: string, sHex: string): Buffer {
    let rBuf = Buffer.from(rHex, "hex");
    let sBuf = Buffer.from(sHex, "hex");
    if (rBuf[0] & 0x80) rBuf = Buffer.concat([Buffer.from([0x00]), rBuf]);
    if (sBuf[0] & 0x80) sBuf = Buffer.concat([Buffer.from([0x00]), sBuf]);
    const body = Buffer.concat([
      Buffer.from([0x02, rBuf.length]),
      rBuf,
      Buffer.from([0x02, sBuf.length]),
      sBuf,
    ]);
    return Buffer.concat([Buffer.from([0x30, body.length]), body]);
  }

  /**
   * Mock do KeyManagementServiceClient do Google Cloud KMS
   */
  function createMockKmsClient(options?: {
    forceHighS?: boolean;
    failGetPublicKey?: boolean;
    failAsymmetricSign?: boolean;
  }) {
    return {
      getPublicKey: async () => {
        if (options?.failGetPublicKey) {
          throw new Error("GCP KMS IAM Permission Denied: roles/cloudkms.signerVerifier required");
        }
        return [{ pem: testPem }];
      },
      asymmetricSign: async ({ digest }: any) => {
        if (options?.failAsymmetricSign) {
          throw new Error("GCP KMS Quota Exceeded (429 Rate Limited)");
        }

        const hash = toHex(digest.sha256);
        const rawSig = await testAccount.sign({ hash });
        const rHex = rawSig.slice(2, 66);
        let sHex = rawSig.slice(66, 130);

        // Se forceHighS for solicitado, injetamos um s > N/2 para testar a normalização EIP-2
        if (options?.forceHighS) {
          const secp256k1N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
          let s = BigInt("0x" + sHex);
          if (s <= secp256k1N / 2n) {
            s = secp256k1N - s; // inverte para ficar high-S
          }
          sHex = s.toString(16).padStart(64, "0");
        }

        const der = rawSigToDer(rHex, sHex);
        return [{ signature: der }];
      },
    } as any;
  }

  describe("parseDerSignature", () => {
    it("deve decodificar assinatura DER válida em rHex e sHex de 32 bytes", () => {
      // Exemplo real de ASN.1 DER para ECDSA secp256k1
      const der = Buffer.from(
        "3045022011223344556677889900aabbccddeeff11223344556677889900aabbccddeeff0221008899aabbccddeeff11223344556677889900aabbccddeeff1122334455667788",
        "hex"
      );

      const result = parseDerSignature(der);
      assert.equal(result.rHex.length, 64);
      assert.equal(result.sHex.length, 64);
      assert.equal(result.rHex, "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff");
      assert.equal(result.sHex, "8899aabbccddeeff11223344556677889900aabbccddeeff1122334455667788");
    });

    it("deve rejeitar bytes inválidos que não começam com 0x30", () => {
      const invalidDer = Buffer.from("020411223344", "hex");
      assert.throws(() => parseDerSignature(invalidDer), /cabeçalho SEQUENCE/);
    });
  });

  describe("GcpKmsOracleSigner", () => {
    it("deve derivar com precisão o endereço Ethereum a partir da chave pública SPKI PEM", async () => {
      const mockClient = createMockKmsClient();
      const signer = new GcpKmsOracleSigner({
        keyVersionName: "projects/maivw-test/locations/global/keyRings/kr/cryptoKeys/k/cryptoKeyVersions/1",
        client: mockClient,
      });

      const address = await signer.getAddress();
      assert.equal(address.toLowerCase(), EXPECTED_ADDRESS.toLowerCase());

      // Segunda chamada deve usar o cache sem consultar o client
      const cached = await signer.getAddress();
      assert.equal(cached.toLowerCase(), EXPECTED_ADDRESS.toLowerCase());
    });

    it("deve falhar com erro descritivo se a API KMS falhar no getPublicKey", async () => {
      const mockClient = createMockKmsClient({ failGetPublicKey: true });
      const signer = new GcpKmsOracleSigner({
        keyVersionName: "projects/maivw-test/locations/global/keyRings/kr/cryptoKeys/k/cryptoKeyVersions/1",
        client: mockClient,
      });

      await assert.rejects(
        async () => await signer.getAddress(),
        /GCP KMS IAM Permission Denied/
      );
    });

    it("deve decodificar credenciais Base64 quando fornecidas", () => {
      const creds = { client_email: "oracle@maivw.iam.gserviceaccount.com", private_key: "fake" };
      const base64 = Buffer.from(JSON.stringify(creds)).toString("base64");

      const signer = new GcpKmsOracleSigner({
        keyVersionName: "projects/maivw-test/locations/global/keyRings/kr/cryptoKeys/k/cryptoKeyVersions/1",
        credentialsJsonBase64: base64,
      });

      assert.ok(signer);
    });

    it("deve falhar se as credenciais Base64 forem JSON inválido", () => {
      assert.throws(
        () =>
          new GcpKmsOracleSigner({
            keyVersionName: "projects/maivw-test/locations/global/keyRings/kr/cryptoKeys/k/cryptoKeyVersions/1",
            credentialsJsonBase64: "not-a-valid-base64-json!!!",
          }),
        /Falha ao decodificar GCP_KMS_CREDENTIALS_BASE64/
      );
    });

    it("deve assinar e normalizar automaticamente caso o HSM retorne High-S (EIP-2)", async () => {
      const mockClient = createMockKmsClient({ forceHighS: true });
      const signer = new GcpKmsOracleSigner({
        keyVersionName: "projects/test/cryptoKeyVersions/1",
        client: mockClient,
      });

      const digest = "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex;
      const sig = await signer.signDigest(digest);

      // Verifica que o s normalizado está na metade inferior
      const sHex = sig.slice(66, 130);
      const sBigInt = BigInt(`0x${sHex}`);
      const secp256k1N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
      assert.ok(sBigInt <= secp256k1N / 2n, "s deve ser menor ou igual a N/2");

      // Verifica que o endereço recuperado bate com a chave
      const recovered = await recoverAddress({ hash: digest, signature: sig });
      assert.equal(recovered.toLowerCase(), EXPECTED_ADDRESS.toLowerCase());
    });
  });

  describe("createGcpKmsAccount (Viem Integration)", () => {
    it("deve instanciar uma conta viem com o endereço derivado do KMS", async () => {
      const mockClient = createMockKmsClient();
      const account = await createGcpKmsAccount({
        keyVersionName: "projects/maivw-test/locations/global/keyRings/kr/cryptoKeys/k/cryptoKeyVersions/1",
        client: mockClient,
      });

      assert.equal(account.address.toLowerCase(), EXPECTED_ADDRESS.toLowerCase());
      assert.equal(typeof account.signTypedData, "function");
      assert.equal(typeof account.signTransaction, "function");
      assert.equal(typeof account.signMessage, "function");
    });

    it("deve assinar dados tipados EIP-712 e recuperar o endereço esperado", async () => {
      const mockClient = createMockKmsClient();

      const account = await createGcpKmsAccount({
        keyVersionName: "projects/test/cryptoKeyVersions/1",
        client: mockClient,
      });

      const typedData = {
        domain: {
          name: "MAIVWRegistry",
          version: "2",
          chainId: 31337,
          verifyingContract: "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address,
        },
        types: {
          Register: [
            { name: "domainHash", type: "bytes32" },
            { name: "publicKey", type: "address" },
            { name: "registrant", type: "address" },
          ],
        },
        primaryType: "Register" as const,
        message: {
          domainHash: "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
          publicKey: EXPECTED_ADDRESS,
          registrant: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
        },
      };

      const signature = await account.signTypedData!(typedData);
      assert.equal(signature.length, 132); // 0x + 64 (r) + 64 (s) + 2 (v) = 132 chars = 65 bytes

      // Valida recovery
      const digest = hashTypedData(typedData);
      const recovered = await recoverAddress({ hash: digest, signature });
      assert.equal(recovered.toLowerCase(), EXPECTED_ADDRESS.toLowerCase());
    });

    it("deve serializar e assinar transações EIP-1559 via signTransaction", async () => {
      const mockClient = createMockKmsClient();

      const account = await createGcpKmsAccount({
        keyVersionName: "projects/test/cryptoKeyVersions/1",
        client: mockClient,
      });

      const tx = {
        to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
        value: 100000000000000n,
        chainId: 31337,
        nonce: 1,
        gas: 50000n,
        maxFeePerGas: 2000000000n,
        maxPriorityFeePerGas: 1000000000n,
        type: "eip1559" as const,
      };

      const signedTx = await account.signTransaction!(tx);
      assert.ok(signedTx.startsWith("0x02")); // Prefixo EIP-1559

      const parsed = parseTransaction(signedTx);
      assert.equal(parsed.type, "eip1559");
      assert.equal(parsed.nonce, 1);
      assert.equal(parsed.to?.toLowerCase(), tx.to.toLowerCase());
      assert.ok(parsed.r && parsed.s);

      // Compara com o signTransaction de referência do viem
      const refSigned = await testAccount.signTransaction(tx);
      assert.equal(signedTx, refSigned);
    });

    it("deve serializar e assinar transações legadas via signTransaction", async () => {
      const mockClient = createMockKmsClient();

      const account = await createGcpKmsAccount({
        keyVersionName: "projects/test/cryptoKeyVersions/1",
        client: mockClient,
      });

      const tx = {
        to: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
        value: 100000000000000n,
        chainId: 31337,
        nonce: 2,
        gas: 50000n,
        gasPrice: 2000000000n,
        type: "legacy" as const,
      };

      const signedTx = await account.signTransaction!(tx);
      const parsed = parseTransaction(signedTx);
      assert.equal(parsed.type, "legacy");
      assert.equal(parsed.nonce, 2);

      const refSigned = await testAccount.signTransaction(tx);
      assert.equal(signedTx, refSigned);
    });
  });
});

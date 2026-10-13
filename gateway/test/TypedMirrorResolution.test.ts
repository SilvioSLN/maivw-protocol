import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LedgerService } from "../src/services/LedgerService.js";

const LEGACY = "0x1111111111111111111111111111111111111111";
const MIRRORS = "0x2222222222222222222222222222222222222222";

function ledgerWith(readContract: (input: any) => Promise<any>): LedgerService {
  const ledger = new LedgerService({
    RPC_URL: "http://localhost:8545",
    CHAIN_ID: 31337,
    REGISTRY_CONTRACT_ADDRESS: LEGACY,
    MIRROR_REGISTRY_V2_ADDRESS: MIRRORS,
  } as any);
  (ledger as any).client = { readContract };
  return ledger;
}

describe("typed mirror resolution", () => {
  it("returns the original Solana key algorithm and status", async () => {
    const ledger = ledgerWith(async ({ functionName }) => {
      if (functionName === "getMirrorProfile") {
        return {
          domain: "solana.maivw.com",
          endpointUrl: "https://solana.maivw.com/inbox",
          publicKey: { algorithm: 2, keyData: `0x${"11".repeat(32)}` },
          adminKey: { algorithm: 2, keyData: `0x${"22".repeat(32)}` },
          status: 1,
        };
      }
      if (functionName === "getMirrorVersion") {
        return {
          exists: true,
          revoked: false,
          originNetworkHash: `0x${"33".repeat(32)}`,
          originRegistry: `0x${"44".repeat(32)}`,
          globalDomainEpoch: 7n,
          originSequence: 19n,
        };
      }
      throw new Error(`unexpected ${functionName}`);
    });

    const identity = await ledger.getTypedDomainIdentity("solana.maivw.com");
    assert.equal(identity?.source, "mirror-v2");
    assert.equal(identity?.publicKey.algorithm, 2);
    assert.equal(identity?.publicKey.keyData, `0x${"11".repeat(32)}`);
    assert.equal(identity?.status, 1);
    assert.equal(identity?.isActive, true);
    assert.equal(identity?.globalDomainEpoch, 7n);
    assert.equal(identity?.originSequence, 19n);
  });

  it("does not mark a revoked tombstone as active", async () => {
    const ledger = ledgerWith(async ({ functionName }) => {
      if (functionName === "getMirrorProfile") {
        return {
          domain: "revoked.maivw.com",
          endpointUrl: "https://revoked.maivw.com/inbox",
          publicKey: { algorithm: 2, keyData: `0x${"55".repeat(32)}` },
          adminKey: { algorithm: 2, keyData: `0x${"66".repeat(32)}` },
          status: 4,
        };
      }
      return {
        exists: true,
        revoked: true,
        originNetworkHash: `0x${"77".repeat(32)}`,
        originRegistry: `0x${"88".repeat(32)}`,
        globalDomainEpoch: 7n,
        originSequence: 20n,
      };
    });

    const identity = await ledger.getTypedDomainIdentity("revoked.maivw.com");
    assert.equal(identity?.status, 4);
    assert.equal(identity?.revoked, true);
    assert.equal(identity?.isActive, false);
  });
});

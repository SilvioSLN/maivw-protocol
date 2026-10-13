import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type Step = {
  operation: string;
  epoch: number;
  sequence: number;
  status: string;
  attestationAction?: number;
  canonicalStake?: string;
  attestedStake?: string;
  spendableLocalStake?: string;
  tombstone?: boolean;
};

type Scenario = {
  id: string;
  originNetwork: string;
  destinationNetwork?: string;
  steps: Step[];
};

const fixture = JSON.parse(
  readFileSync(
    new URL("../../specs/multichain/fixtures/full-lifecycle-v1.json", import.meta.url),
    "utf8",
  ),
) as { schema: string; scenarios: Scenario[] };

function scenario(id: string): Scenario {
  const result = fixture.scenarios.find((item) => item.id === id);
  assert.ok(result, `missing scenario ${id}`);
  return result;
}

function assertMonotonicVersion(steps: Step[]): void {
  for (let index = 1; index < steps.length; index += 1) {
    const previous = steps[index - 1];
    const current = steps[index];
    const isNewer =
      current.epoch > previous.epoch ||
      (current.epoch === previous.epoch && current.sequence > previous.sequence);
    assert.ok(isNewer, `${current.operation} must advance epoch/sequence`);
    if (current.epoch > previous.epoch) {
      assert.equal(current.sequence, 1, `${current.operation} must restart sequence at one`);
    }
  }
}

describe("full multichain lifecycle V1 fixture", () => {
  it("covers every required lifecycle operation", () => {
    assert.equal(fixture.schema, "maivw-full-lifecycle-v1");
    const operations = new Set(
      fixture.scenarios.flatMap((item) => item.steps.map((step) => step.operation)),
    );

    for (const operation of [
      "register",
      "update",
      "register_provider",
      "warning",
      "slash",
      "recovery",
      "reclaim",
      "register_mirror",
      "sync_mirror",
      "revoke_mirror",
    ]) {
      assert.ok(operations.has(operation), `missing ${operation}`);
    }
  });

  it("defines deterministic epoch and sequence transitions", () => {
    for (const item of fixture.scenarios) assertMonotonicVersion(item.steps);

    const domain = scenario("solana-origin-domain-lifecycle");
    assert.match(domain.originNetwork, /^solana:/);
    assert.deepEqual(
      domain.steps.map(({ operation, epoch, sequence }) => ({ operation, epoch, sequence })),
      [
        { operation: "register", epoch: 1, sequence: 1 },
        { operation: "update", epoch: 1, sequence: 2 },
        { operation: "recovery", epoch: 2, sequence: 1 },
        { operation: "reclaim", epoch: 3, sequence: 1 },
      ],
    );
  });

  it("keeps mirror economics read-only and revocation as a tombstone", () => {
    const mirror = scenario("solana-to-evm-mirror-lifecycle");
    assert.match(mirror.originNetwork, /^solana:/);
    assert.match(mirror.destinationNetwork ?? "", /^evm:/);
    assert.deepEqual(mirror.steps.map((step) => step.attestationAction), [2, 3, 4]);
    assert.ok(mirror.steps.every((step) => step.attestedStake !== undefined));
    assert.ok(mirror.steps.every((step) => step.spendableLocalStake === "0"));
    assert.equal(mirror.steps.at(-1)?.status, "revoked");
    assert.equal(mirror.steps.at(-1)?.tombstone, true);
  });

  it("captures provider warning and slash consequences", () => {
    const provider = scenario("evm-origin-provider-enforcement");
    assert.deepEqual(provider.steps.map((step) => step.status), ["active", "active", "suspended"]);
    assert.ok(
      BigInt(provider.steps[2].canonicalStake ?? "0") <
        BigInt(provider.steps[1].canonicalStake ?? "0"),
    );
  });
});

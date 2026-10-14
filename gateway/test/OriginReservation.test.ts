import test from "node:test";
import assert from "node:assert/strict";
import { size, type Hex } from "viem";
import {
  OriginReservationError,
  OriginReservationService,
  verifyReservationAuditChain,
  type CreateDnsChallengeInput,
} from "../src/multichain/OriginReservation.js";

const EVM_REGISTRY = `0x${"0".repeat(24)}${"1".repeat(40)}` as Hex;
const EVM_REGISTRANT = `0x${"0".repeat(24)}${"2".repeat(40)}` as Hex;
const SOLANA_REGISTRY = `0x${"3".repeat(64)}` as Hex;
const SOLANA_REGISTRANT = `0x${"4".repeat(64)}` as Hex;
const PAYLOAD_HASH = `0x${"5".repeat(64)}` as Hex;
const BASE_TIME = new Date("2026-10-14T12:00:00.000Z");

function challengeInput(overrides: Partial<CreateDnsChallengeInput> = {}): CreateDnsChallengeInput {
  return {
    domain: "Example.COM",
    requesterId: 7,
    origin: { family: "EVM", networkId: "evm:8453", registryId: EVM_REGISTRY },
    registrant: { algorithm: "SECP256K1_EVM", key: EVM_REGISTRANT },
    now: BASE_TIME,
    ...overrides,
  };
}

function solanaChallengeInput(now = BASE_TIME): CreateDnsChallengeInput {
  return challengeInput({
    origin: {
      family: "SOLANA",
      networkId: "solana:11111111111111111111111111111111",
      registryId: SOLANA_REGISTRY,
    },
    registrant: { algorithm: "ED25519_SOLANA", key: SOLANA_REGISTRANT },
    now,
  });
}

function memoryDatabase() {
  const challenges = new Map<string, any>();
  const reservations = new Map<string, any>();
  const claims = new Map<string, any>();
  const audits: any[] = [];
  const outbox: any[] = [];
  const activeOriginHashes = new Set<string>();

  const findReservation = (where: any) => [...reservations.values()].find((row) => {
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.dnsChallengeId !== undefined && row.dnsChallengeId !== where.dnsChallengeId) return false;
    if (where.requesterId !== undefined && row.requesterId !== where.requesterId) return false;
    if (where.idempotencyKeyHash !== undefined && row.idempotencyKeyHash !== where.idempotencyKeyHash) return false;
    if (where.blockingDomainHash !== undefined && row.blockingDomainHash !== where.blockingDomainHash) return false;
    return true;
  }) ?? null;

  const originRecord = {
    findUnique: async ({ where }: any) => activeOriginHashes.has(where.domainHash)
      ? { id: "active", domainHash: where.domainHash }
      : null,
  };
  const originDnsChallenge = {
    findUnique: async ({ where }: any) => challenges.get(where.id) ?? null,
    findFirst: async () => null,
    create: async ({ data }: any) => {
      const row = { ...data };
      challenges.set(row.id, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = challenges.get(where.id);
      const updated = { ...row, ...data };
      challenges.set(where.id, updated);
      return updated;
    },
    updateMany: async () => ({ count: 0 }),
  };
  const originReservation = {
    findUnique: async ({ where }: any) => findReservation(where),
    findFirst: async ({ where }: any) => findReservation(where),
    create: async ({ data }: any) => {
      if ([...reservations.values()].some((row) => row.blockingDomainHash === data.blockingDomainHash)) {
        throw Object.assign(new Error("blocking domain unique"), { code: "P2002" });
      }
      if ([...reservations.values()].some((row) => row.requesterId === data.requesterId
        && row.idempotencyKeyHash === data.idempotencyKeyHash)) {
        throw Object.assign(new Error("idempotency unique"), { code: "P2002" });
      }
      const row = { ...data };
      reservations.set(row.id, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = findReservation(where);
      if (!row) throw new Error("reservation not found");
      const updated = { ...row, ...data, updatedAt: data.updatedAt ?? row.updatedAt };
      reservations.set(row.id, updated);
      return updated;
    },
    updateMany: async () => ({ count: 0 }),
  };
  const findClaim = (where: any) => [...claims.values()].find((row) => {
    if (where.reservationId !== undefined && row.reservationId !== where.reservationId) return false;
    if (where.idempotencyKeyHash !== undefined && row.idempotencyKeyHash !== where.idempotencyKeyHash) return false;
    return true;
  }) ?? null;
  const originClaimIssuance = {
    findUnique: async ({ where }: any) => findClaim(where),
    findFirst: async ({ where }: any) => findClaim(where),
    create: async ({ data }: any) => {
      if (findClaim({ reservationId: data.reservationId }) || findClaim({ idempotencyKeyHash: data.idempotencyKeyHash })) {
        throw Object.assign(new Error("claim unique"), { code: "P2002" });
      }
      const row = { ...data };
      claims.set(row.id, row);
      return row;
    },
    update: async () => { throw new Error("not implemented"); },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const [id, row] of claims) {
        if (row.reservationId === where.reservationId && row.status === where.status) {
          claims.set(id, { ...row, ...data });
          count += 1;
        }
      }
      return { count };
    },
  };
  const originReservationAuditEvent = {
    findUnique: async () => null,
    findFirst: async () => null,
    findMany: async ({ where, take }: any) => audits
      .filter((event) => event.reservationId === where.reservationId)
      .slice(0, take),
    create: async ({ data }: any) => {
      const { outboxEvent, ...eventData } = data;
      const event = {
        ordinal: BigInt(audits.length + 1),
        previousState: null,
        actorIdHash: null,
        previousEventHash: null,
        ...eventData,
      };
      audits.push(event);
      outbox.push({ auditEventId: event.id, status: "PENDING", ...outboxEvent.create });
      return event;
    },
    update: async () => { throw new Error("append-only"); },
    updateMany: async () => ({ count: 0 }),
  };
  const database = {
    originRecord,
    originDnsChallenge,
    originReservation,
    originClaimIssuance,
    originReservationAuditEvent,
    $transaction: async (operation: (tx: any) => Promise<any>) => operation({
      originRecord,
      originDnsChallenge,
      originReservation,
      originClaimIssuance,
      originReservationAuditEvent,
    }),
  };
  return { database, challenges, reservations, claims, audits, outbox, activeOriginHashes };
}

function fixture() {
  const memory = memoryDatabase();
  let dnsFound = true;
  let signerCalls = 0;
  const service = new OriginReservationService(
    memory.database as any,
    { hasTxt: async () => dnsFound },
    {
      signDigest: async () => {
        signerCalls += 1;
        return {
          signature: `0x${"ab".repeat(65)}` as Hex,
          keyId: "kms/origin-signer",
          keyVersion: "1",
        };
      },
    },
    {
      challengeTtlMs: 60_000,
      reservationTtlMs: 10_000,
      claimTtlMs: 10_000,
      evmFinalityMarginMs: 5_000,
      solanaFinalityMarginMs: 2_000,
    },
  );
  return {
    memory,
    service,
    setDnsFound: (value: boolean) => { dnsFound = value; },
    signerCalls: () => signerCalls,
  };
}

async function reserveEvm(instance = fixture(), now = BASE_TIME) {
  const created = await instance.service.createDnsChallenge(challengeInput({ now }));
  const result = await instance.service.verifyDnsAndReserve({
    challengeId: created.challenge.id,
    requesterId: 7,
    token: created.token,
    idempotencyKey: "reserve-example-evm",
    requestId: "request-reserve-example-evm",
    now,
  });
  return { instance, created, result };
}

test("desafio DNS vincula domínio, rede, Registry e registrante sem persistir o token", async () => {
  const { memory, service } = fixture();
  const created = await service.createDnsChallenge(solanaChallengeInput());

  assert.equal(created.challenge.originNetworkFamily, "SOLANA");
  assert.equal(created.challenge.originRegistryId, SOLANA_REGISTRY);
  assert.equal(created.challenge.registrantKey, SOLANA_REGISTRANT);
  assert.match(created.dnsRecord.host, /^_maivw-verify\.example\.com$/);
  assert.ok(created.dnsRecord.value.includes(created.challenge.id));
  assert.ok(!JSON.stringify([...memory.challenges.values()]).includes(created.token));
  assert.notEqual(created.challenge.tokenHash, created.token);
  assert.equal(memory.reservations.size, 0, "emitir challenge não bloqueia o domínio");
});

test("reserva exige TXT exato e retry idêntico não duplica auditoria/outbox", async () => {
  const instance = fixture();
  const created = await instance.service.createDnsChallenge(challengeInput());
  instance.setDnsFound(false);
  await assert.rejects(
    instance.service.verifyDnsAndReserve({
      challengeId: created.challenge.id,
      requesterId: 7,
      token: created.token,
      idempotencyKey: "reserve-example-evm",
      requestId: "dns-missing",
      now: BASE_TIME,
    }),
    (error: unknown) => error instanceof OriginReservationError && error.code === "DNS_PROOF_NOT_FOUND",
  );
  assert.equal(instance.memory.reservations.size, 0);

  instance.setDnsFound(true);
  const input = {
    challengeId: created.challenge.id,
    requesterId: 7,
    token: created.token,
    idempotencyKey: "reserve-example-evm",
    requestId: "dns-found",
    now: BASE_TIME,
  };
  const first = await instance.service.verifyDnsAndReserve(input);
  const retry = await instance.service.verifyDnsAndReserve({ ...input, requestId: "dns-found-retry" });
  const retryAfterChallengeExpiry = await instance.service.verifyDnsAndReserve({
    ...input,
    requestId: "dns-found-retry-after-expiry",
    now: new Date(BASE_TIME.getTime() + 61_000),
  });
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(retryAfterChallengeExpiry.created, false);
  assert.equal(first.reservation.id, retry.reservation.id);
  assert.equal(instance.memory.audits.length, 1);
  assert.equal(instance.memory.outbox.length, 1);

  await assert.rejects(
    instance.service.verifyDnsAndReserve({
      ...input,
      idempotencyKey: "different-key-same-challenge",
      requestId: "reuse-consumed-challenge",
    }),
    (error: unknown) => error instanceof OriginReservationError && error.code === "DNS_CHALLENGE_ALREADY_USED",
  );
});

test("corrida entre desafios EVM e Solana produz uma única reserva bloqueante", async () => {
  const instance = fixture();
  const evm = await instance.service.createDnsChallenge(challengeInput());
  const solana = await instance.service.createDnsChallenge(solanaChallengeInput());
  const attempts = await Promise.allSettled([
    instance.service.verifyDnsAndReserve({
      challengeId: evm.challenge.id,
      requesterId: 7,
      token: evm.token,
      idempotencyKey: "race-evm",
      requestId: "race-evm",
      now: BASE_TIME,
    }),
    instance.service.verifyDnsAndReserve({
      challengeId: solana.challenge.id,
      requesterId: 7,
      token: solana.token,
      idempotencyKey: "race-solana",
      requestId: "race-solana",
      now: BASE_TIME,
    }),
  ]);

  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  const rejected = attempts.find((attempt) => attempt.status === "rejected") as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof OriginReservationError);
  assert.equal(rejected.reason.code, "ORIGIN_ALREADY_RESERVED");
  assert.equal([...instance.memory.reservations.values()].filter((row) => row.blockingDomainHash).length, 1);
});

test("OriginClaimV1 é assinado uma vez, vincula a reserva e mantém hold de finalidade", async () => {
  const { instance, result } = await reserveEvm();
  const issueInput = {
    reservationId: result.reservation.id,
    requesterId: 7,
    payloadHash: PAYLOAD_HASH,
    idempotencyKey: "claim-example-evm",
    requestId: "request-claim-example-evm",
    now: new Date(BASE_TIME.getTime() + 1_000),
  };
  const first = await instance.service.issueOriginClaim(issueInput);
  const retry = await instance.service.issueOriginClaim({ ...issueInput, requestId: "claim-retry" });

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(instance.signerCalls(), 1);
  assert.equal(size(first.claim.encoded as Hex), 292);
  assert.equal(first.claim.nonce, result.reservation.nonce);
  assert.equal(first.claim.evidenceHash, result.reservation.dnsEvidenceHash);
  assert.equal(first.claim.signature, `0x${"ab".repeat(65)}`);
  assert.equal(first.reservation.status, "CLAIM_ISSUED");
  assert.equal(first.reservation.claimDeadline?.toISOString(), "2026-10-14T12:00:11.000Z");
  assert.equal(first.reservation.holdUntil.toISOString(), "2026-10-14T12:00:16.000Z");
  assert.equal(instance.memory.audits.length, 2);
  assert.deepEqual(verifyReservationAuditChain(instance.memory.audits), {
    valid: true,
    lastEventHash: instance.memory.audits[1].eventHash,
  });
  await assert.rejects(
    instance.service.issueOriginClaim({
      ...issueInput,
      payloadHash: `0x${"6".repeat(64)}` as Hex,
      requestId: "claim-other-payload",
    }),
    (error: unknown) => error instanceof OriginReservationError && error.code === "IDEMPOTENCY_MISMATCH",
  );
});

test("hold expirado libera o domínio para outra rede e preserva histórico", async () => {
  const { instance, result } = await reserveEvm();
  await instance.service.issueOriginClaim({
    reservationId: result.reservation.id,
    requesterId: 7,
    payloadHash: PAYLOAD_HASH,
    idempotencyKey: "claim-example-evm",
    requestId: "claim-example-evm",
    now: new Date(BASE_TIME.getTime() + 1_000),
  });
  const solana = await instance.service.createDnsChallenge(
    solanaChallengeInput(new Date(BASE_TIME.getTime() + 2_000)),
  );
  const replacement = await instance.service.verifyDnsAndReserve({
    challengeId: solana.challenge.id,
    requesterId: 7,
    token: solana.token,
    idempotencyKey: "reserve-example-solana-after-expiry",
    requestId: "reserve-example-solana-after-expiry",
    now: new Date(BASE_TIME.getTime() + 17_000),
  });

  const previous = instance.memory.reservations.get(result.reservation.id);
  assert.equal(previous.status, "EXPIRED");
  assert.equal(previous.blockingDomainHash, null);
  assert.equal([...instance.memory.claims.values()][0].status, "EXPIRED");
  assert.equal(replacement.reservation.originNetworkFamily, "SOLANA");
  assert.equal(replacement.reservation.blockingDomainHash, replacement.reservation.domainHash);
  const oldHistory = instance.memory.audits.filter((event) => event.reservationId === previous.id);
  assert.equal(oldHistory.at(-1).action, "RESERVATION_EXPIRED");
  assert.equal(verifyReservationAuditChain(oldHistory).valid, true);
});

test("origem já ativa impede novos desafios", async () => {
  const instance = fixture();
  instance.memory.activeOriginHashes.add("0x02438d3405cadd648e08dbff51bdbeb415913e642189100dc4a012064c870883");
  await assert.rejects(
    instance.service.createDnsChallenge(challengeInput()),
    (error: unknown) => error instanceof OriginReservationError && error.code === "ORIGIN_ALREADY_ACTIVE",
  );
});
